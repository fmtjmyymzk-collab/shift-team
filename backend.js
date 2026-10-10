/* データの保存先。
   firebase : 本番用（Googleの Firebase に保存。config.js の設定が必要）
   demo     : お試し用（この端末の中だけ。サンプルの店とスタッフが入っている） */
(function(){
  'use strict';
  var cfg = window.SHIFT_FIREBASE_CONFIG || {};
  var hasFirebase = !!(cfg.apiKey && String(cfg.apiKey).indexOf('YOUR_') !== 0 && window.firebase && window.firebase.initializeApp);

  var ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';           // 紛らわしい文字（I L O 0 1）を除く
  var SH = ['A','B','C','D'];
  var DEFAULT_SHIFTS = {A:{label:'朝',time:''}, B:{label:'昼',time:''}, C:{label:'夕',time:''}, D:{label:'夜',time:''}};
  var DEFAULT_REQUIRED = {A:2, B:2, C:2, D:1};
  var SAMPLE = 'DEMO2345';

  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function newCode(){
    var a = new Uint32Array(8), s = '', i;
    (window.crypto || window.msCrypto).getRandomValues(a);
    for(i=0; i<8; i++) s += ALPHA[a[i] % ALPHA.length];
    return s;
  }
  function normCode(c){ return String(c||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
  function fmtCode(c){ return c && c.length===8 ? c.slice(0,4)+'-'+c.slice(4) : (c||''); }
  function err(code, msg){ var e = new Error(msg || code); e.code = code; return e; }
  function errMsg(e){
    var c = (e && e.code) || '';
    var m = {
      'auth/email-already-in-use':'このメールアドレスは登録済みです。「ログイン」から入ってください',
      'auth/invalid-email':'メールアドレスの形式が正しくありません',
      'auth/missing-password':'パスワードを入力してください',
      'auth/weak-password':'パスワードは6文字以上にしてください',
      'auth/wrong-password':'メールアドレスかパスワードが違います',
      'auth/invalid-credential':'メールアドレスかパスワードが違います',
      'auth/user-not-found':'メールアドレスかパスワードが違います',
      'auth/too-many-requests':'しばらく待ってから、もう一度お試しください',
      'auth/network-request-failed':'通信できません。電波を確認してください',
      'auth/operation-not-allowed':'この方法のログインが有効になっていません（SETUP.md の手順2を確認してください）',
      'bad-code':'店コードが見つかりません。もう一度確認してください',
      'permission-denied':'権限がありません。店コードを確認してください',
      'unavailable':'通信できません。電波を確認してください',
      'not-found':'見つかりませんでした'
    };
    return m[c] || (e && e.message) || 'うまくいきませんでした';
  }
  function mkStore(id, d){
    return {
      id: id, name: d.name || '', managerUid: d.managerUid || '',
      shifts: Object.assign(clone(DEFAULT_SHIFTS), d.shifts || {}),
      required: Object.assign(clone(DEFAULT_REQUIRED), d.required || {}),
      deadlineDay: d.deadlineDay || 0
    };
  }

  /* ================= Firebase ================= */
  function makeFirebase(){
    if(!firebase.apps.length) firebase.initializeApp(cfg);
    var auth = firebase.auth(), db = firebase.firestore();
    var TS = firebase.firestore.FieldValue.serverTimestamp;
    function U(u){ return u ? {uid:u.uid, anon:u.isAnonymous, email:u.email || ''} : null; }
    function ms(t){ return t && t.toMillis ? t.toMillis() : (typeof t==='number' ? t : 0); }
    function sref(id){ return db.collection('stores').doc(id); }
    function stripReq(d){ return {uid:d.uid, ym:d.ym, name:d.name, days:d.days||{}, gen:d.gen||{}, note:d.note||'', updatedAt:ms(d.updatedAt)}; }

    return {
      mode: 'firebase',
      init: function(){
        return new Promise(function(res){
          var un = auth.onAuthStateChanged(function(u){ un(); res(U(u)); });
        });
      },
      user: function(){ return U(auth.currentUser); },
      signUp: function(email, pw){ return auth.createUserWithEmailAndPassword(email, pw).then(function(c){ return U(c.user); }); },
      signIn: function(email, pw){ return auth.signInWithEmailAndPassword(email, pw).then(function(c){ return U(c.user); }); },
      resetPassword: function(email){ return auth.sendPasswordResetEmail(email); },
      signOut: function(){ return auth.signOut(); },

      createStore: function(name){
        var u = auth.currentUser;
        if(!u || u.isAnonymous) return Promise.reject(err('auth/required','ログインしてください'));
        function attempt(n){
          var id = newCode();
          var data = {name:name, managerUid:u.uid, shifts:clone(DEFAULT_SHIFTS), required:clone(DEFAULT_REQUIRED), deadlineDay:0};
          var w = Object.assign({}, data, {createdAt: TS()});
          return sref(id).set(w).then(function(){ return mkStore(id, data); }, function(e){
            if(n < 3 && e && e.code === 'permission-denied') return attempt(n+1);   // 店コードが重なった時は作り直す
            throw e;
          });
        }
        return attempt(0);
      },
      myStores: function(){
        var u = auth.currentUser;
        if(!u || u.isAnonymous) return Promise.resolve([]);
        return db.collection('stores').where('managerUid','==',u.uid).get().then(function(s){
          return s.docs.map(function(d){ return mkStore(d.id, d.data()); });
        });
      },
      getStore: function(id){
        return sref(id).get().then(function(s){ return s.exists ? mkStore(s.id, s.data()) : null; }, function(){ return null; });
      },
      updateStore: function(id, patch){ return sref(id).update(patch); },

      joinStore: function(code, name){
        code = normCode(code);
        var p = auth.currentUser ? Promise.resolve(auth.currentUser) : auth.signInAnonymously().then(function(c){ return c.user; });
        return p.then(function(u){
          return sref(code).collection('members').doc(u.uid).set({name:name, role:'staff', joinedAt:TS()});
        }).then(function(){
          return sref(code).get();
        }).then(function(s){
          if(!s.exists) throw err('bad-code');
          return mkStore(s.id, s.data());
        }).catch(function(e){
          if(e && e.code === 'permission-denied') throw err('bad-code');
          throw e;
        });
      },
      leaveStore: function(id){
        var u = auth.currentUser; if(!u) return Promise.resolve();
        return sref(id).collection('members').doc(u.uid).delete();
      },
      listMembers: function(id){
        return sref(id).collection('members').get().then(function(s){
          return s.docs.map(function(d){ var x = d.data(); return {uid:d.id, name:x.name || '', joinedAt:ms(x.joinedAt)}; });
        });
      },
      removeMember: function(id, uid, ym){
        var batch = db.batch();
        batch.delete(sref(id).collection('members').doc(uid));
        if(ym) batch.delete(sref(id).collection('requests').doc(ym+'_'+uid));
        return batch.commit();
      },

      submitRequest: function(id, ym, p){
        var u = auth.currentUser; if(!u) return Promise.reject(err('auth/required','もう一度、店に参加してください'));
        var data = {uid:u.uid, ym:ym, name:p.name, days:clone(p.days||{}), gen:clone(p.gen||{}), note:p.note||'', updatedAt:TS()};
        return sref(id).collection('requests').doc(ym+'_'+u.uid).set(data).then(function(){ return {updatedAt: Date.now()}; });
      },
      getMyRequest: function(id, ym){
        var u = auth.currentUser; if(!u) return Promise.resolve(null);
        return sref(id).collection('requests').doc(ym+'_'+u.uid).get().then(function(s){ return s.exists ? stripReq(s.data()) : null; }, function(){ return null; });
      },
      listRequests: function(id, ym){
        return sref(id).collection('requests').where('ym','==',ym).get().then(function(s){
          return s.docs.map(function(d){ return stripReq(d.data()); });
        });
      },
      errMsg: errMsg
    };
  }

  /* ================= デモ（この端末の中だけ） ================= */
  function makeDemo(){
    var K = 'shiftDemo.v1';
    var NAMES = ['田中','鈴木','佐藤','高橋','伊藤','グエン','リー','ラナ'];
    function load(){
      try{ var s = JSON.parse(localStorage.getItem(K)); if(s && s.stores) return s; }catch(e){}
      return {users:{}, stores:{}, members:{}, requests:{}, session:null};
    }
    function save(d){ try{ localStorage.setItem(K, JSON.stringify(d)); }catch(e){} }
    function ensureSample(d){
      if(d.stores[SAMPLE]) return;
      d.stores[SAMPLE] = {id:SAMPLE, name:'デモ店（サンプル）', managerUid:'demo-manager', shifts:clone(DEFAULT_SHIFTS), required:clone(DEFAULT_REQUIRED), deadlineDay:20, sample:true};
      d.members[SAMPLE] = {};
      NAMES.forEach(function(n,i){ d.members[SAMPLE]['demo-'+(i+1)] = {name:n, role:'staff', joinedAt:Date.now()-86400000*(30-i)}; });
      d.requests[SAMPLE] = {};
    }
    function rng(seed){ var s = (seed>>>0) || 1; return function(){ s = (s*1664525 + 1013904223)>>>0; return s/4294967296; }; }
    function seedRequests(d, id, ym){
      var reqs = d.requests[id] = d.requests[id] || {};
      var pt = ym.split('-'), y = +pt[0], m = +pt[1], n = new Date(y, m, 0).getDate();
      Object.keys(d.members[id] || {}).forEach(function(uid){
        if(uid.indexOf('demo-') !== 0) return;
        var idx = +uid.slice(5), k = ym+'_'+uid;
        if(reqs[k] || idx >= 7) return;                      // 7・8番目の人は未提出のまま
        var r = rng(y*100 + m + idx*977), days = {}, dd;
        for(dd=1; dd<=n; dd++){
          var w = new Date(y, m-1, dd).getDay(), p = r(), s, off = (idx%7 === w) ? 0.85 : 0.18;
          if(p < off) s = 'x'; else if(p < off+0.12) s = 't'; else if(p < 0.97) s = 'o'; else s = '';
          var sh = [];
          if((s==='o' || s==='t') && r() < 0.6){
            var a = Math.floor(r()*4); sh = [SH[a]];
            if(r() < 0.4){ var b = Math.floor(r()*4); if(b !== a) sh.push(SH[b]); }
            sh.sort();
          }
          days[dd] = {s:s, sh:sh, n:''};
        }
        reqs[k] = {uid:uid, ym:ym, name:d.members[id][uid].name, days:days, gen:{weekly:'3'}, note:'', updatedAt:Date.now()-3600000*(idx*5+3)};
      });
    }
    function sess(d){ return d.session; }
    function ok(v){ return Promise.resolve(v); }

    var B = {
      mode: 'demo',
      init: function(){ var d = load(); ensureSample(d); save(d); return ok(sess(d)); },
      user: function(){ return sess(load()); },
      enterDemoManager: function(){
        var d = load(); ensureSample(d); d.session = {uid:'demo-manager', anon:false, email:'demo@example.com'}; save(d);
        return ok(mkStore(SAMPLE, d.stores[SAMPLE]));
      },
      signUp: function(email, pw){
        var d = load(); email = String(email||'').trim();
        if(!/^\S+@\S+\.\S+$/.test(email)) return Promise.reject(err('auth/invalid-email'));
        if(String(pw||'').length < 6) return Promise.reject(err('auth/weak-password'));
        if(d.users[email]) return Promise.reject(err('auth/email-already-in-use'));
        d.users[email] = {uid:'m-'+newCode(), pw:pw}; d.session = {uid:d.users[email].uid, anon:false, email:email}; save(d);
        return ok(d.session);
      },
      signIn: function(email, pw){
        var d = load(), u = d.users[String(email||'').trim()];
        if(!u || u.pw !== pw) return Promise.reject(err('auth/invalid-credential'));
        d.session = {uid:u.uid, anon:false, email:String(email).trim()}; save(d);
        return ok(d.session);
      },
      resetPassword: function(){ return ok(); },
      signOut: function(){ var d = load(); d.session = null; save(d); return ok(); },

      createStore: function(name){
        var d = load(), s = sess(d);
        if(!s || s.anon) return Promise.reject(err('auth/required','ログインしてください'));
        var id = newCode();
        d.stores[id] = {id:id, name:name, managerUid:s.uid, shifts:clone(DEFAULT_SHIFTS), required:clone(DEFAULT_REQUIRED), deadlineDay:0};
        d.members[id] = {}; d.requests[id] = {}; save(d);
        return ok(mkStore(id, d.stores[id]));
      },
      myStores: function(){
        var d = load(), s = sess(d); if(!s || s.anon) return ok([]);
        return ok(Object.keys(d.stores).filter(function(k){ return d.stores[k].managerUid === s.uid; }).map(function(k){ return mkStore(k, d.stores[k]); }));
      },
      getStore: function(id){ var d = load(); ensureSample(d); return ok(d.stores[id] ? mkStore(id, d.stores[id]) : null); },
      updateStore: function(id, patch){
        var d = load(); if(!d.stores[id]) return Promise.reject(err('not-found'));
        Object.keys(patch).forEach(function(k){ d.stores[id][k] = clone(patch[k]); }); save(d); return ok();
      },

      joinStore: function(code, name){
        code = normCode(code);
        var d = load(); ensureSample(d);
        if(!d.stores[code]) return Promise.reject(err('bad-code'));
        if(!d.session){ d.session = {uid:'s-'+newCode(), anon:true, email:''}; }
        d.members[code] = d.members[code] || {};
        d.members[code][d.session.uid] = {name:name, role:'staff', joinedAt:Date.now()}; save(d);
        return ok(mkStore(code, d.stores[code]));
      },
      leaveStore: function(id){ var d = load(), s = sess(d); if(s && d.members[id]) delete d.members[id][s.uid]; save(d); return ok(); },
      listMembers: function(id){
        var d = load(), m = d.members[id] || {};
        return ok(Object.keys(m).map(function(u){ return {uid:u, name:m[u].name, joinedAt:m[u].joinedAt}; }));
      },
      removeMember: function(id, uid, ym){
        var d = load(); if(d.members[id]) delete d.members[id][uid];
        if(ym && d.requests[id]) delete d.requests[id][ym+'_'+uid]; save(d); return ok();
      },

      submitRequest: function(id, ym, p){
        var d = load(), s = sess(d); if(!s) return Promise.reject(err('auth/required','もう一度、店に参加してください'));
        d.requests[id] = d.requests[id] || {};
        var at = Date.now();
        d.requests[id][ym+'_'+s.uid] = {uid:s.uid, ym:ym, name:p.name, days:clone(p.days||{}), gen:clone(p.gen||{}), note:p.note||'', updatedAt:at};
        if(d.members[id] && d.members[id][s.uid]) d.members[id][s.uid].name = p.name;
        save(d); return ok({updatedAt:at});
      },
      getMyRequest: function(id, ym){
        var d = load(), s = sess(d); if(!s) return ok(null);
        var r = (d.requests[id] || {})[ym+'_'+s.uid]; return ok(r ? clone(r) : null);
      },
      listRequests: function(id, ym){
        var d = load();
        if(d.stores[id] && d.stores[id].sample){ seedRequests(d, id, ym); save(d); }
        var q = d.requests[id] || {};
        return ok(Object.keys(q).filter(function(k){ return q[k].ym === ym; }).map(function(k){ return clone(q[k]); }));
      },
      errMsg: errMsg
    };
    return B;
  }

  var fb = null;
  if(hasFirebase){ try{ fb = makeFirebase(); }catch(e){ fb = null; } }
  window.ShiftBackend = {
    firebase: fb,
    demo: makeDemo(),
    util: {normCode:normCode, fmtCode:fmtCode, newCode:newCode, errMsg:errMsg, SAMPLE:SAMPLE, SH:SH, DEFAULT_SHIFTS:DEFAULT_SHIFTS, DEFAULT_REQUIRED:DEFAULT_REQUIRED}
  };
})();
