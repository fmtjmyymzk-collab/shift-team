/* 店との連携：参加・スタッフの提出・店長の集計画面 */
(function(){
  'use strict';
  var C = window.ShiftCore, BK = window.ShiftBackend;
  if(!C || !BK) return;
  var U = BK.util, SH = U.SH;
  var WD = ['日','月','火','水','木','金','土'];
  var KEY = 'shiftTeam.v1', SEEN = 'shiftTeam.seen';

  var S = {backend:'', role:'', storeId:''};      // この端末の状態（保存する）
  var store = null, members = [], requests = [], myReq = null;
  var lastKey = '', armed = false, armT = null, busy = false;
  var mYm = null, mTab = 'sum', onlyShort = false, V = {name:'', d:{}};
  var pending = {}, saveT = null, armedDel = '';

  /* ---------- 道具 ---------- */
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function toast(m){ C.toast(m); }
  function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
  function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }
  function loadS(){ try{ var s = JSON.parse(lsGet(KEY)); if(s && s.role && s.backend && BK[s.backend]) S = s; }catch(e){} }
  function saveS(){ lsSet(KEY, JSON.stringify(S)); }
  function B(){ return BK[S.backend]; }
  function canon(v){
    if(Array.isArray(v)) return '['+v.map(canon).join(',')+']';
    if(v && typeof v === 'object') return '{'+Object.keys(v).sort().map(function(k){ return JSON.stringify(k)+':'+canon(v[k]); }).join(',')+'}';
    return JSON.stringify(v);
  }
  function ymStr(o){ return o.y+'-'+(o.m<10?'0':'')+o.m; }
  function dimOf(o){ return new Date(o.y, o.m, 0).getDate(); }
  function two(n){ return (n<10?'0':'')+n; }
  function fmtAt(ms){ if(!ms) return ''; var d = new Date(ms); return (d.getMonth()+1)+'/'+d.getDate()+' '+two(d.getHours())+':'+two(d.getMinutes()); }
  function appUrl(){ return window.SHIFT_APP_URL || (location.origin + location.pathname.replace(/index\.html$/, '')); }
  function copyText(t){
    function fb(){
      var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); toast('コピーしました'); }catch(e){ toast('コピーできませんでした'); }
      document.body.removeChild(ta);
    }
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function(){ toast('コピーしました'); }, fb); else fb();
  }
  function lineLink(t){ return 'https://line.me/R/msg/text/?'+encodeURIComponent(t); }
  function deadlineOf(o, st){
    if(!st || !st.deadlineDay) return null;
    var base = new Date(o.y, o.m-2, 1), last = new Date(base.getFullYear(), base.getMonth()+1, 0).getDate();
    var day = Math.min(st.deadlineDay, last);
    return {text:(base.getMonth()+1)+'/'+day, end:new Date(base.getFullYear(), base.getMonth(), day, 23, 59, 59)};
  }
  function shiftName(k){ var s = store && store.shifts && store.shifts[k]; return (s && s.label) || {A:'朝',B:'昼',C:'夕',D:'夜'}[k]; }
  function shiftTime(k){ var s = store && store.shifts && store.shifts[k]; return (s && s.time) || ''; }
  function isDemo(){ return S.backend === 'demo'; }

  /* ---------- 画面の部品を差し込む ---------- */
  function injectUI(){
    var hd = document.querySelector('header.top');
    var bar = document.createElement('button'); bar.id = 'teamBar'; bar.className = 't-bar'; hd.appendChild(bar);
    var scr = document.createElement('div'); scr.id = 'tScreen'; scr.className = 't-screen'; scr.hidden = true; document.body.appendChild(scr);
    var sh = document.createElement('div'); sh.id = 'tSheet'; sh.className = 'sheet'; sh.hidden = true;
    sh.innerHTML = '<div class="in t-sh" role="dialog" aria-modal="true"></div>'; document.body.appendChild(sh);
    var mg = document.createElement('div'); mg.id = 'mgr'; mg.className = 't-mgr'; mg.hidden = true; document.body.appendChild(mg);
    var card = document.createElement('div'); card.id = 'tSubmit'; card.className = 'card no-print t-submit'; card.hidden = true;
    var po = $('p-out'); po.insertBefore(card, po.firstChild);
    var dock = document.createElement('button'); dock.id = 'tSubmitDock'; dock.className = 'btn primary'; dock.hidden = true;
    var row = $('outDock').querySelector('.in'); row.insertBefore(dock, row.firstChild);

    bar.addEventListener('click', function(){ if(S.role === 'staff' && store) openStaffMenu(); else showView('choose'); });
    $('tScreen').addEventListener('click', onScreenClick);
    $('tSheet').addEventListener('click', function(e){ if(e.target === $('tSheet')) closeSheet(); else onSheetClick(e); });
    $('mgr').addEventListener('click', onMgrClick);
    $('mgr').addEventListener('input', onMgrInput);
    $('mgr').addEventListener('change', onMgrInput);
    card.addEventListener('click', function(e){ if(e.target.closest('[data-act="submit"]')) submit(); });
    dock.addEventListener('click', submit);
    document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeSheet(); });
  }
  function openSheet(html){ $('tSheet').firstChild.innerHTML = html; $('tSheet').hidden = false; }
  function closeSheet(){ $('tSheet').hidden = true; armedDel = ''; }

  /* ================= 参加・ログインの画面 ================= */
  function showView(name, d){
    V = {name:name, d:d||{}};
    $('tScreen').innerHTML = '<div class="t-in">'+VIEWS[name](V.d)+'</div>';
    $('tScreen').hidden = false; $('tScreen').scrollTop = 0;
  }
  function hideScreen(){ $('tScreen').hidden = true; lsSet(SEEN, '1'); }
  function setErr(m){ var e = $('tErr'); if(e) e.innerHTML = m ? '<p class="t-err">'+esc(m)+'</p>' : ''; }
  function setBusy(on){ busy = on; var b = $('tScreen').querySelector('[data-main]'); if(b){ b.disabled = on; b.style.opacity = on ? .6 : ''; } }

  var VIEWS = {
    choose: function(){
      var note = BK.firebase ? '' : '<p class="t-note">いまは<b>デモ版</b>です（サーバーに未接続）。サンプルの店で、操作を試せます。</p>';
      return '<h2>お店とつなぐ</h2><p class="lead">希望を店長にまとめて届けられます。</p>'+note
        + '<div class="t-choice">'
        + '<button class="main" data-act="goJoin"><b>スタッフとして参加</b><span>店長から聞いた店コードを入力します</span></button>'
        + '<button data-act="goMgr"><b>店長として使う</b><span>全員の希望の集計と、提出状況を見ます</span></button>'
        + '<button data-act="solo"><b>ひとりで使う</b><span>これまで通り、LINEに画像や文章で送ります</span></button>'
        + '</div><button class="link" data-act="demo">デモを試す（サンプルの店）</button>';
    },
    join: function(d){
      return '<button class="link t-back" data-act="goChoose">‹ もどる</button><h2>スタッフとして参加</h2>'
        + '<p class="lead">店長から聞いた店コードと、あなたの名前を入力してください。</p><div id="tErr"></div>'
        + '<label class="t-field">店コード<input id="tjCode" class="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="9" placeholder="XXXX-XXXX" value="'+esc(d.code||'')+'"></label>'
        + '<label class="t-field">あなたの名前<input id="tjName" autocomplete="name" maxlength="20" placeholder="山田 太郎" value="'+esc(C.getName())+'"><small>店長の画面に、この名前が出ます</small></label>'
        + '<button class="btn primary wide" data-act="doJoin" data-main>参加する</button>'
        + (BK.firebase ? '' : '<p class="m-help">デモ版の店コードは <b>'+U.fmtCode(U.SAMPLE)+'</b> です。</p>');
    },
    mgrAuth: function(d){
      var m = d.mode || 'new';
      return '<button class="link t-back" data-act="goChoose">‹ もどる</button><h2>店長として使う</h2>'
        + (BK.firebase ? '' : '<p class="t-note">デモ版です。登録した内容は、この端末の中だけに保存されます。</p>')
        + '<div class="seg" role="group"><button data-act="authMode" data-m="new" aria-pressed="'+(m==='new')+'">はじめて</button><button data-act="authMode" data-m="in" aria-pressed="'+(m==='in')+'">ログイン</button></div>'
        + '<div id="tErr"></div>'
        + '<label class="t-field">メールアドレス<input id="taMail" type="email" autocomplete="email" inputmode="email" value="'+esc(d.email||'')+'"></label>'
        + '<label class="t-field">パスワード'+(m==='new'?'（6文字以上）':'')+'<input id="taPass" type="password" autocomplete="'+(m==='new'?'new-password':'current-password')+'"></label>'
        + '<button class="btn primary wide" data-act="doAuth" data-main>'+(m==='new'?'登録して始める':'ログイン')+'</button>'
        + (m==='in' ? '<p style="margin:12px 0 0"><button class="link" data-act="doReset">パスワードを忘れた</button></p>' : '');
    },
    mgrNew: function(){
      return '<h2>お店を作る</h2><p class="lead">店の名前を入力してください。あとから変更できます。</p><div id="tErr"></div>'
        + '<label class="t-field">店名<input id="tnName" maxlength="40" placeholder="〇〇店"></label>'
        + '<button class="btn primary wide" data-act="doCreate" data-main>お店を作る</button>';
    },
    mgrPick: function(d){
      return '<h2>お店を選ぶ</h2><div class="t-list">'
        + (d.list||[]).map(function(s){ return '<button data-act="pickStore" data-id="'+esc(s.id)+'"><span>'+esc(s.name)+'</span><span>›</span></button>'; }).join('')
        + '</div><button class="btn wide" data-act="goNewStore">新しいお店を作る</button>';
    }
  };

  function onScreenClick(e){
    var b = e.target.closest('[data-act]'); if(!b || busy && b.hasAttribute('data-main')) return;
    var a = b.dataset.act;
    if(a === 'goChoose') showView('choose');
    else if(a === 'goJoin') showView('join');
    else if(a === 'goMgr') showView('mgrAuth', {mode:'new'});
    else if(a === 'goNewStore') showView('mgrNew', V.d);
    else if(a === 'solo'){ hideScreen(); }
    else if(a === 'demo') startDemo();
    else if(a === 'authMode'){ showView('mgrAuth', {mode:b.dataset.m, email:($('taMail')||{}).value||''}); }
    else if(a === 'doJoin') doJoin();
    else if(a === 'doAuth') doAuth();
    else if(a === 'doReset') doReset();
    else if(a === 'doCreate') doCreate();
    else if(a === 'pickStore'){ var st = (V.d.list||[]).filter(function(s){ return s.id === b.dataset.id; })[0]; if(st) startManager(V.d.bk, st); }
  }

  function pickBackend(code){ return code === U.SAMPLE ? 'demo' : (BK.firebase ? 'firebase' : 'demo'); }
  function doJoin(){
    var code = U.normCode($('tjCode').value), name = $('tjName').value.trim();
    if(code.length < 6){ setErr('店コードを入力してください'); return; }
    if(!name){ setErr('名前を入力してください'); return; }
    var bk = pickBackend(code); setErr(''); setBusy(true);
    BK[bk].init().then(function(u){ if(u && !u.anon) return BK[bk].signOut(); }).then(function(){ return BK[bk].joinStore(code, name); }).then(function(st){
      S = {backend:bk, role:'staff', storeId:st.id}; saveS(); store = st; C.setName(name);
      setBusy(false); hideScreen(); applyStaff(); toast(st.name+'に参加しました');
    }).catch(function(e){ setBusy(false); setErr(BK[bk].errMsg(e)); });
  }
  function doAuth(){
    var mode = V.d.mode || 'new', mail = $('taMail').value.trim(), pw = $('taPass').value;
    var bk = BK.firebase ? 'firebase' : 'demo';
    if(!mail){ setErr('メールアドレスを入力してください'); return; }
    setErr(''); setBusy(true);
    BK[bk].init().then(function(){ return mode === 'new' ? BK[bk].signUp(mail, pw) : BK[bk].signIn(mail, pw); })
      .then(function(){ return BK[bk].myStores(); })
      .then(function(list){
        setBusy(false);
        if(!list.length) showView('mgrNew', {bk:bk});
        else if(list.length === 1) startManager(bk, list[0]);
        else showView('mgrPick', {bk:bk, list:list});
      }).catch(function(e){ setBusy(false); setErr(BK[bk].errMsg(e)); });
  }
  function doReset(){
    var mail = $('taMail').value.trim(), bk = BK.firebase ? 'firebase' : 'demo';
    if(!mail){ setErr('メールアドレスを入力してください'); return; }
    BK[bk].resetPassword(mail).then(function(){ setErr(''); toast('再設定のメールを送りました'); }, function(e){ setErr(BK[bk].errMsg(e)); });
  }
  function doCreate(){
    var name = $('tnName').value.trim(), bk = (V.d && V.d.bk) || (BK.firebase ? 'firebase' : 'demo');
    if(!name){ setErr('店名を入力してください'); return; }
    setErr(''); setBusy(true);
    BK[bk].createStore(name).then(function(st){ setBusy(false); startManager(bk, st); }).catch(function(e){ setBusy(false); setErr(BK[bk].errMsg(e)); });
  }
  function startDemo(){
    BK.demo.init().then(function(){ return BK.demo.enterDemoManager(); }).then(function(st){ startManager('demo', st); });
  }
  function startManager(bk, st){
    S = {backend:bk, role:'manager', storeId:st.id}; saveS(); store = st; hideScreen(); enterManagerUI();
  }

  /* ================= スタッフ側 ================= */
  function applyStaff(){
    document.body.classList.add('team-staff'); document.body.classList.remove('team-mgr');
    C.setShiftLabels(store.shifts);
    myReq = null; lastKey = ''; fetchMyReq(); renderStaff();
  }
  function hasLocalData(){ var m = C.getMonth(), k; for(k in m.days){ if(m.days[k] && m.days[k].s) return true; } return false; }
  function fetchMyReq(){
    if(S.role !== 'staff' || !store) return;
    var key = C.ymKey(); lastKey = key;
    B().getMyRequest(store.id, key).then(function(r){
      if(C.ymKey() !== key) return;
      myReq = r;
      if(r && !hasLocalData()){ C.setMonth(key, {days:r.days, gen:r.gen, note:r.note}); toast('店長に出した内容を読み込みました'); }
      renderStaff();
    });
  }
  function staffStatus(){
    if(!myReq) return 'none';
    var m = C.getMonth();
    return canon({days:m.days, gen:m.gen, note:m.note}) === canon({days:myReq.days, gen:myReq.gen, note:myReq.note}) ? 'saved' : 'changed';
  }
  var ST_TXT = {none:'未提出', saved:'提出済み', changed:'変更あり'};
  function renderStaff(){
    var bar = $('teamBar'), card = $('tSubmit'), dock = $('tSubmitDock');
    if(S.role !== 'staff' || !store){
      document.body.classList.remove('team-staff');
      card.hidden = true; dock.hidden = true; $('shareImgBtn').textContent = 'LINEに画像を送る';
      if(S.role !== 'manager') bar.innerHTML = '<b>お店とつなぐ</b><span class="sp"></span><span class="go">›</span>';
      return;
    }
    var st = staffStatus(), dl = deadlineOf(C.getYm(), store), late = dl && new Date() > dl.end && st !== 'saved';
    bar.innerHTML = '<b>'+esc(shopName())+'</b>'+(dl?'<span class="dl">締切 '+esc(dl.text)+'</span>':'')
      + '<span class="sp"></span><span class="st st-'+st+'">'+ST_TXT[st]+'</span>';
    var ym = C.getYm();
    card.innerHTML = '<h2>'+esc(shopName())+'に提出</h2><div class="meta"><span>'+ym.y+'年'+ym.m+'月分</span>'
      + (dl ? '<span>締切 '+esc(dl.text)+(late?'（過ぎています）':'')+'</span>' : '')
      + '<span class="st st-'+st+'">'+ST_TXT[st]+(myReq && myReq.updatedAt ? '　'+fmtAt(myReq.updatedAt) : '')+'</span></div>'
      + '<p class="m-help" style="margin:0">'+(st === 'saved' ? '提出が済んでいます。内容を変えた時は、もう一度提出してください。' : (st === 'changed' ? '提出したあとに、内容を変えています。もう一度提出してください。' : '内容を確認して、下の「店長に提出」を押してください。'))+'</p>';
    card.hidden = false;
    dock.textContent = st === 'saved' ? '提出済み ✓' : (armed ? 'このまま提出' : (st === 'changed' ? '再提出する' : '店長に提出')); dock.hidden = false;
    $('shareImgBtn').textContent = '画像で送る';
  }
  function shopName(){ return store.name + (isDemo() && store.name.indexOf('デモ') < 0 ? '（デモ）' : ''); }
  function submit(){
    if(!store || busy) return;
    var name = (C.getName() || '').trim();
    if(!name){ toast('お名前を入力してください'); C.showTab('out'); var f = $('f-name'); if(f) f.focus(); return; }
    var m = C.getMonth(), ym = C.getYm(), n = dimOf(ym), dec = 0, d;
    for(d=1; d<=n; d++){ var x = m.days[d]; if(x && x.s) dec++; }
    if(dec === 0){ toast('日別の希望を入力してください'); C.showTab('days'); return; }
    if(dec < n && !armed){
      armed = true; renderStaff(); toast('未定の日が'+(n-dec)+'日あります。このままなら、もう一度押してください');
      clearTimeout(armT); armT = setTimeout(function(){ armed = false; renderStaff(); }, 8000); return;
    }
    armed = false; clearTimeout(armT); busy = true;
    B().submitRequest(store.id, C.ymKey(), {name:name, days:m.days, gen:m.gen, note:m.note}).then(function(r){
      busy = false; myReq = {days:m.days, gen:m.gen, note:m.note, updatedAt:r.updatedAt}; renderStaff(); toast('店長に提出しました');
    }).catch(function(e){ busy = false; renderStaff(); toast(B().errMsg(e)); });
  }
  function openStaffMenu(){
    var dl = deadlineOf(C.getYm(), store);
    var times = SH.map(function(k){ return '<tr><th>'+k+' '+esc(shiftName(k))+'</th><td>'+(esc(shiftTime(k)) || '<span class="t-none">時間は未設定</span>')+'</td></tr>'; }).join('');
    openSheet('<h3>'+esc(shopName())+'</h3><p class="sub">'+(dl ? '締切：'+esc(dl.text)+'まで' : '締切は設定されていません')+'</p>'
      + '<div class="t-grp"><div class="gl">シフトの時間帯</div><table class="t-tbl">'+times+'</table></div>'
      + '<div class="actions"><button class="btn" data-act="closeSheet">閉じる</button>'
      + '<button class="btn warn" data-act="leave">この店から抜ける</button></div>');
  }
  function leaveStore(){
    var id = store && store.id;
    (id ? B().leaveStore(id) : Promise.resolve()).catch(function(){}).then(function(){
      S = {backend:'', role:'', storeId:''}; lsDel(KEY); store = null; myReq = null; armed = false;
      document.body.classList.remove('team-staff'); C.setShiftLabels(null); closeSheet(); renderStaff(); toast('店から抜けました');
    });
  }

  /* ================= 店長画面 ================= */
  function enterManagerUI(){
    document.body.classList.add('team-mgr'); document.body.classList.remove('team-staff');
    $('teamBar').hidden = true; $('tSubmit').hidden = true; $('tSubmitDock').hidden = true;
    $('mgr').hidden = false;
    if(!mYm){ var y = C.getYm(); mYm = {y:y.y, m:y.m}; }
    mTab = 'sum'; loadMgr();
  }
  function leaveManagerUI(){
    document.body.classList.remove('team-mgr'); $('mgr').hidden = true; $('teamBar').hidden = false;
    S = {backend:'', role:'', storeId:''}; lsDel(KEY); store = null; members = []; requests = []; renderStaff(); window.scrollTo(0,0);
  }
  function loadMgr(){
    renderMgr(true);
    var ym = ymStr(mYm);
    return Promise.all([B().listMembers(store.id), B().listRequests(store.id, ym)]).then(function(r){
      members = r[0]; requests = r[1]; renderMgr();
    }).catch(function(e){ $('mgr').querySelector('.m-main').innerHTML = '<div class="m-empty">読み込めませんでした。<br>'+esc(B().errMsg(e))+'<br><br><button class="btn" data-act="reload">もう一度読み込む</button></div>'; });
  }

  function aggregate(){
    var n = dimOf(mYm), byUid = {}, cells = {}, xs = {}, subm = {}, d;
    members.forEach(function(m){ byUid[m.uid] = m; });
    for(d=1; d<=n; d++){ cells[d] = {}; SH.forEach(function(k){ cells[d][k] = {o:[], t:[]}; }); xs[d] = []; }
    requests.forEach(function(r){
      var m = byUid[r.uid]; if(!m) return;
      var name = r.name || m.name; subm[r.uid] = r;
      for(d=1; d<=n; d++){
        var x = r.days && r.days[d]; if(!x || !x.s) continue;
        if(x.s === 'x'){ xs[d].push(name); continue; }
        (x.sh && x.sh.length ? x.sh : SH).forEach(function(k){ if(cells[d][k]) cells[d][k][x.s].push(name); });
      }
    });
    return {n:n, byUid:byUid, cells:cells, xs:xs, subm:subm};
  }
  function cellState(c, need){
    if(!need) return 'n';
    if(c.o.length >= need) return 'ok';
    if(c.o.length + c.t.length >= need) return 'warn';
    return 'ng';
  }
  function nameOf(A, uid){ var r = A.subm[uid], m = A.byUid[uid]; return (r && r.name) || (m && m.name) || ''; }
  function dayLabel(d){
    var w = new Date(mYm.y, mYm.m-1, d).getDay(), hol = C.holidayName(mYm.y, mYm.m, d);
    return {w:w, hol:hol, cls:(w===6?'sat':'')+(w===0?' sun':'')+(hol?' hol':''), html:d+'<span>'+WD[w]+(hol?' 祝':'')+'</span>'};
  }

  function renderMgr(loading){
    var ym = mYm;
    var tabs = [['sum','集計'],['sub','提出状況'],['set','設定']].map(function(t){
      return '<button data-act="mtab" data-t="'+t[0]+'" aria-selected="'+(mTab===t[0])+'">'+t[1]+'</button>';
    }).join('');
    var head = '<header class="m-top"><div class="in"><div class="m-bar"><div class="m-store"><small>店長画面'+(isDemo()?'（デモ）':'')+'</small><b>'+esc(store.name)+'</b></div>'
      + '<div class="month"><button data-act="mprev" aria-label="前の月">‹</button><div class="label"><small>'+ym.y+'年</small><b>'+ym.m+'月</b></div><button data-act="mnext" aria-label="次の月">›</button></div></div>'
      + '<div class="steps" role="tablist">'+tabs+'</div></div></header>';
    var body;
    if(loading) body = '<div class="m-empty">読み込み中…</div>';
    else if(mTab === 'sum') body = bodySum();
    else if(mTab === 'sub') body = bodySub();
    else body = bodySet();
    var keep = loading ? 0 : window.scrollY;
    $('mgr').innerHTML = head + '<main class="m-main">'+body+'</main>';
    if(!loading && mTab !== 'set') window.scrollTo(0, keep);
  }

  function bodySum(){
    if(!members.length) return emptyNoMember();
    var A = aggregate(), req = store.required || {}, ng = 0, warn = 0, ok = 0, rows = '', d;
    for(d=1; d<=A.n; d++){
      var anyNg = false, tds = '';
      SH.forEach(function(k){
        var c = A.cells[d][k], need = req[k] || 0, st = cellState(c, need);
        if(st === 'ng'){ ng++; anyNg = true; } else if(st === 'warn') warn++; else if(st === 'ok') ok++;
        tds += '<td><button class="t-cell '+st+'" data-act="cell" data-d="'+d+'" data-k="'+k+'" aria-label="'+d+'日 '+esc(shiftName(k))+' ○'+c.o.length+'人 △'+c.t.length+'人">'
          + '<span>'+c.o.length+'</span>'+(need?'<small>/'+need+'</small>':'')+(c.t.length?'<i>+'+c.t.length+'</i>':'')+'</button></td>';
      });
      if(onlyShort && !anyNg) continue;
      var dl = dayLabel(d);
      rows += '<tr class="'+dl.cls+'"><td class="d">'+dl.html+'</td>'+tds+'</tr>';
    }
    var th = SH.map(function(k){ return '<th>'+k+' '+esc(shiftName(k))+'<small>'+(esc(shiftTime(k)) || '必要'+(req[k]||0)+'人')+'</small></th>'; }).join('');
    var submitted = Object.keys(A.subm).length;
    return '<div class="m-sum"><span class="m-pill ng">足りない '+ng+'コマ</span><span class="m-pill warn">△を入れれば足りる '+warn+'コマ</span><span class="m-pill ok">足りている '+ok+'コマ</span></div>'
      + '<div class="m-tools"><label><input type="checkbox" data-act="short" '+(onlyShort?'checked':'')+'>足りない日だけ表示</label>'
      + '<span>提出 '+submitted+'/'+members.length+'人</span>'
      + '<span class="lg"><i style="background:var(--ok-bg)"></i>足りる</span><span class="lg"><i style="background:var(--tri-bg)"></i>△込みで足りる</span><span class="lg"><i style="background:var(--ng-bg)"></i>不足</span></div>'
      + (submitted < members.length ? '<p class="m-help" style="margin:0 0 10px">未提出の人は、まだ人数に入っていません。数字は「○の人数 / 必要人数」、+の数字は△の人数です。</p>' : '<p class="m-help" style="margin:0 0 10px">数字は「○の人数 / 必要人数」、+の数字は△の人数です。コマをタップすると、名前が見られます。</p>')
      + '<div class="m-mx-wrap"><table class="m-mx"><thead><tr><th>日</th>'+th+'</tr></thead><tbody>'+(rows || '<tr><td colspan="5" class="m-empty">足りない日はありません</td></tr>')+'</tbody></table></div>';
  }
  function emptyNoMember(){
    return '<div class="card m-empty">まだ誰も参加していません。<br>「設定」の店コードをスタッフに送ってください。<br><br><button class="btn primary" data-act="mtab" data-t="set">店コードを見る</button></div>';
  }

  function counts(r, n){
    var c = {o:0,t:0,x:0,u:0}, d;
    for(d=1; d<=n; d++){ var x = r && r.days && r.days[d]; if(x && x.s) c[x.s]++; else c.u++; }
    return c;
  }
  function remindText(list){
    var dl = deadlineOf(mYm, store);
    return '【出勤希望の提出のお願い】\n'+mYm.m+'月分の出勤希望を、アプリで提出してください。\n'
      + (list && list.length ? '（未提出：'+list.join('、')+'）\n' : '')
      + (dl ? '締切：'+dl.text+'\n' : '')
      + '\nアプリ：'+appUrl()+'\n店コード：'+U.fmtCode(store.id);
  }
  function inviteText(){
    var dl = deadlineOf(mYm, store);
    return '【出勤希望の提出について】\n'+store.name+'の出勤希望を、アプリで出してください。\n\n'
      + '① '+appUrl()+' を開く\n② 「ホーム画面に追加」する\n③ ホーム画面のアプリを開いて、店コードと名前を入力\n\n店コード：'+U.fmtCode(store.id)
      + (dl ? '\n締切：毎月'+store.deadlineDay+'日（'+mYm.m+'月分は'+dl.text+'まで）' : '');
  }
  function bodySub(){
    if(!members.length) return emptyNoMember();
    var A = aggregate(), n = A.n, done = 0, list = [], unsub = [];
    var people = members.map(function(m){
      var r = A.subm[m.uid]; if(r) done++; else unsub.push(m.name);
      return {m:m, r:r, c:counts(r, n)};
    }).sort(function(a,b){ return (a.r?1:0)-(b.r?1:0) || a.m.name.localeCompare(b.m.name, 'ja'); });
    var dl = deadlineOf(mYm, store), late = dl && new Date() > dl.end;
    list = people.map(function(p){
      return '<button class="m-person" data-act="person" data-u="'+esc(p.m.uid)+'"><div class="nm">'+esc(p.r && p.r.name || p.m.name)
        + '<small>'+(p.r ? fmtAt(p.r.updatedAt)+' に提出' : '参加 '+fmtAt(p.m.joinedAt))+(p.r && p.c.u ? '　未定'+p.c.u+'日' : '')+'</small></div>'
        + (p.r ? '<div class="cnt"><span class="o">○'+p.c.o+'</span><span class="t">△'+p.c.t+'</span><span class="x">×'+p.c.x+'</span></div><span class="st st-saved">提出済み</span>'
               : '<span class="st st-none">未提出</span>')
        + '</button>';
    }).join('');
    var pct = Math.round(done / members.length * 100);
    return '<div class="m-prog"><b>'+done+'/'+members.length+'人</b><div class="m-bar-trk"><div class="m-bar-fill" style="width:'+pct+'%"></div></div></div>'
      + (dl ? '<p class="m-help" style="margin:0 0 10px">締切 '+esc(dl.text)+(late && unsub.length ? '（過ぎています）' : '')+'</p>' : '')
      + '<div class="m-people">'+list+'</div>'
      + (unsub.length ? '<div class="t-row"><a class="btn primary" target="_blank" rel="noopener" href="'+lineLink(remindText(unsub))+'">未提出の人にLINEで催促</a><button class="btn" data-act="copyRemind">催促文をコピー</button></div>'
                     : '<p class="m-help">全員が提出しました。</p>');
  }

  function bodySet(){
    var req = store.required || {}, dls = '<option value="0">設定しない</option>', i;
    for(i=1; i<=28; i++) dls += '<option value="'+i+'"'+(store.deadlineDay===i?' selected':'')+'>'+i+'日</option>';
    var need = SH.map(function(k){
      return '<div class="m-need-row"><span class="k">'+k+'</span><div class="fields"><input class="lb" data-f="label" data-k="'+k+'" maxlength="2" value="'+esc(shiftName(k))+'" aria-label="'+k+'の名前"><input class="tm" data-f="time" data-k="'+k+'" maxlength="16" placeholder="例 6〜10時" value="'+esc(shiftTime(k))+'" aria-label="'+k+'の時間"></div>'
        + '<div class="m-step"><span class="nd">必要人数</span><button data-act="need" data-k="'+k+'" data-v="-1" aria-label="'+k+'を減らす">−</button><output>'+(req[k]||0)+'人</output><button data-act="need" data-k="'+k+'" data-v="1" aria-label="'+k+'を増やす">＋</button></div></div>';
    }).join('');
    return '<div class="m-set">'
      + '<div class="card"><h2>店コード</h2><div class="m-code"><b>'+esc(U.fmtCode(store.id))+'</b><button class="btn sm" data-act="copyCode">コピー</button></div>'
      + '<div class="t-row"><a class="btn primary" target="_blank" rel="noopener" href="'+lineLink(inviteText())+'">スタッフにLINEで案内を送る</a><button class="btn" data-act="copyInvite">案内文をコピー</button></div>'
      + '<p class="m-help">スタッフは、この店コードと名前だけで参加できます。'+(isDemo()?'デモ版の店コードは、この端末の中でだけ使えます。':'')+'</p></div>'
      + '<div class="card"><h2>お店の名前</h2><input class="m-sel" id="msName" data-f="name" maxlength="40" value="'+esc(store.name)+'"></div>'
      + '<div class="card"><h2>時間帯と必要人数</h2><p class="m-help" style="margin:0 0 10px">名前は2文字まで。右の人数は、そのコマに必要な人数です。集計の色分けに使います。</p><div class="m-need">'+need+'</div></div>'
      + '<div class="card"><h2>提出の締切</h2><select class="m-sel" id="msDeadline" data-f="deadline">'+dls+'</select><p class="m-help">たとえば「20日」にすると、11月分は10月20日までになります。スタッフの画面に表示されます。</p></div>'
      + '<div class="card"><h2>アカウント</h2><div class="t-row"><button class="btn" data-act="switchSolo">店長画面を閉じる</button><button class="btn warn" data-act="signOut">ログアウト</button></div></div></div>';
  }

  /* ---- 店長画面のタップ ---- */
  function onMgrClick(e){
    var b = e.target.closest('[data-act]'); if(!b) return;
    var a = b.dataset.act;
    if(a === 'mtab'){ mTab = b.dataset.t; renderMgr(); window.scrollTo(0,0); }
    else if(a === 'mprev' || a === 'mnext'){
      mYm.m += (a === 'mnext' ? 1 : -1);
      if(mYm.m < 1){ mYm.m = 12; mYm.y--; } if(mYm.m > 12){ mYm.m = 1; mYm.y++; }
      loadMgr();
    }
    else if(a === 'short'){ onlyShort = b.checked; renderMgr(); }
    else if(a === 'cell') openCell(+b.dataset.d, b.dataset.k);
    else if(a === 'person') openPerson(b.dataset.u);
    else if(a === 'copyCode') copyText(U.fmtCode(store.id));
    else if(a === 'copyInvite') copyText(inviteText());
    else if(a === 'copyRemind'){ var A = aggregate(); copyText(remindText(members.filter(function(m){ return !A.subm[m.uid]; }).map(function(m){ return m.name; }))); }
    else if(a === 'need'){
      var k = b.dataset.k, v = Math.max(0, Math.min(20, (store.required[k]||0) + (+b.dataset.v)));
      store.required[k] = v; queueSave({required:store.required}); renderMgr();
    }
    else if(a === 'reload') loadMgr();
    else if(a === 'switchSolo') leaveManagerUI();
    else if(a === 'signOut'){ B().signOut().catch(function(){}).then(leaveManagerUI); }
  }
  function onMgrInput(e){
    var t = e.target, f = t.dataset && t.dataset.f; if(!f) return;
    if(f === 'name'){ var nm = t.value.trim(); if(!nm) return; store.name = nm; queueSave({name:nm}); }
    else if(f === 'deadline'){ store.deadlineDay = +t.value; queueSave({deadlineDay:store.deadlineDay}); }
    else if(f === 'label' || f === 'time'){
      var k = t.dataset.k; store.shifts[k] = Object.assign({label:shiftName(k), time:shiftTime(k)}, store.shifts[k] || {});
      store.shifts[k][f] = t.value.trim() || (f === 'label' ? shiftName(k) : '');
      queueSave({shifts:store.shifts});
    }
  }
  function queueSave(p){
    Object.keys(p).forEach(function(k){ pending[k] = p[k]; });
    clearTimeout(saveT);
    saveT = setTimeout(function(){
      var patch = pending; pending = {};
      B().updateStore(store.id, patch).then(function(){ toast('保存しました'); }, function(e){ toast(B().errMsg(e)); });
    }, 700);
  }

  /* ---- シート：コマの内訳・個人の内訳 ---- */
  function chips(arr, cls){ return arr.length ? '<div class="t-names '+cls+'">'+arr.map(function(n){ return '<span>'+esc(n)+'</span>'; }).join('')+'</div>' : '<p class="t-none">いません</p>'; }
  function openCell(d, k){
    var A = aggregate(), c = A.cells[d][k], need = (store.required||{})[k] || 0, dl = dayLabel(d);
    var unsub = members.filter(function(m){ return !A.subm[m.uid]; }).map(function(m){ return m.name; });
    openSheet('<h3>'+mYm.m+'月'+d+'日（'+WD[dl.w]+'）'+(dl.hol ? ' '+esc(dl.hol) : '')+'</h3>'
      + '<p class="sub">'+k+' '+esc(shiftName(k))+(shiftTime(k) ? '（'+esc(shiftTime(k))+'）' : '')+(need ? '　必要 '+need+'人' : '')+'</p>'
      + '<div class="t-grp"><div class="gl">○ 出れる（'+c.o.length+'人）</div>'+chips(c.o,'o')+'</div>'
      + '<div class="t-grp"><div class="gl">△ 条件付き（'+c.t.length+'人）</div>'+chips(c.t,'t')+'</div>'
      + '<div class="t-grp"><div class="gl">× その日は出られない（'+A.xs[d].length+'人）</div>'+chips(A.xs[d],'x')+'</div>'
      + (unsub.length ? '<div class="t-grp"><div class="gl">未提出（'+unsub.length+'人）</div>'+chips(unsub,'')+'</div>' : '')
      + '<p class="m-help">時間帯を選ばずに○を付けた人は、いつでも出られるとして数えています。</p>'
      + '<div class="actions"><button class="btn primary" data-act="closeSheet">閉じる</button></div>');
  }
  function openPerson(uid){
    var A = aggregate(), m = A.byUid[uid]; if(!m) return;
    var r = A.subm[uid], name = nameOf(A, uid);
    if(!r){
      openSheet('<h3>'+esc(name)+'</h3><p class="sub">まだ提出していません（参加 '+fmtAt(m.joinedAt)+'）</p>'+removeBtn(uid));
      return;
    }
    var rows = '', d, SYM = {o:'○', t:'△', x:'×'};
    for(d=1; d<=A.n; d++){
      var x = r.days[d] || {s:'',sh:[],n:''}, dl = dayLabel(d);
      rows += '<tr class="'+(x.s||'')+'"><td>'+d+'（'+WD[dl.w]+'）</td><td class="s">'+(SYM[x.s] || '－')+'</td><td>'+(x.s === 'x' ? '' : (x.s ? (x.sh && x.sh.length ? x.sh.join(' ') : 'いつでも') : ''))+'</td><td>'+esc(x.n||'')+'</td></tr>';
    }
    var gen = r.gen || {}, labels = {weekly:'勤務回数（週）',consec:'連続勤務最長',workdays:'勤務希望曜日',monthly:'勤務回数（月）',offdays:'休み希望曜日',stores:'他店舗'}, g = '';
    Object.keys(labels).forEach(function(k){ var v = gen[k]; v = Array.isArray(v) ? v.join('・') : (v||''); if(v) g += '<tr><th>'+labels[k]+'</th><td>'+esc(v)+'</td></tr>'; });
    if(r.note) g += '<tr><th>備考</th><td>'+esc(r.note)+'</td></tr>';
    openSheet('<h3>'+esc(name)+'</h3><p class="sub">'+mYm.m+'月分　'+fmtAt(r.updatedAt)+' に提出</p>'
      + '<table class="t-tbl"><tr><th>日</th><th>可否</th><th>時間帯</th><th>メモ</th></tr>'+rows+'</table>'
      + (g ? '<div class="t-grp"><div class="gl">全体の希望</div><table class="t-tbl">'+g+'</table></div>' : '')
      + removeBtn(uid));
  }
  function removeBtn(uid){
    return '<div class="actions"><button class="btn primary" data-act="closeSheet">閉じる</button>'
      + '<button class="btn warn'+(armedDel === uid ? ' armed' : '')+'" data-act="delMember" data-u="'+esc(uid)+'">'+(armedDel === uid ? '本当に削除する' : 'このスタッフを削除')+'</button></div>';
  }
  function onSheetClick(e){
    var b = e.target.closest('[data-act]'); if(!b) return;
    var a = b.dataset.act;
    if(a === 'closeSheet') closeSheet();
    else if(a === 'leave'){
      if(armedDel === 'leave') leaveStore(); else { armedDel = 'leave'; b.textContent = '本当に抜ける'; b.classList.add('armed'); }
    }
    else if(a === 'delMember'){
      var u = b.dataset.u;
      if(armedDel !== u){ armedDel = u; b.textContent = '本当に削除する'; b.classList.add('armed'); return; }
      armedDel = '';
      B().removeMember(store.id, u, ymStr(mYm)).then(function(){ closeSheet(); toast('削除しました'); loadMgr(); }, function(err){ toast(B().errMsg(err)); });
    }
  }

  /* ================= 起動 ================= */
  function init(){
    injectUI(); loadS();
    C.onChange(function(){
      if(S.role !== 'staff' || !store) return;
      if(C.ymKey() !== lastKey) fetchMyReq(); else renderStaff();
    });
    var q = ''; try{ q = new URLSearchParams(location.search).get('code') || ''; }catch(e){}
    if(S.role === 'staff'){
      renderStaff();
      B().init().then(function(){ return B().getStore(S.storeId); }).then(function(st){
        if(!st){ toast('お店につながりません。店コードを確認してください'); S = {backend:'',role:'',storeId:''}; lsDel(KEY); renderStaff(); return; }
        store = st; applyStaff();
      });
    } else if(S.role === 'manager'){
      $('teamBar').hidden = true;
      B().init().then(function(u){
        if(!u || u.anon){ leaveManagerUI(); showView('mgrAuth', {mode:'in'}); return; }
        return B().getStore(S.storeId).then(function(st){
          if(!st){ leaveManagerUI(); showView('mgrAuth', {mode:'in'}); return; }
          store = st; enterManagerUI();
        });
      });
    } else {
      renderStaff();
      if(q) showView('join', {code:q});
      else if(!lsGet(SEEN) && !hasLocalData()) showView('choose');
    }
  }
  init();
})();
