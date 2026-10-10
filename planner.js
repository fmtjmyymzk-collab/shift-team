/* シフトを自動で組む（ブラウザでも Node でも動く、画面に依存しない計算だけの部品）
   入力 : 月・必要人数・全員の希望（○△×・時間帯・週の回数・連勤の上限・月の上限・休み希望曜日）
   出力 : 誰がどの日のどのコマに入るか {日: {A: [uid, ...], ...}}

   決まり
   ・1人は1日1コマまで（同じ人を朝と夜に二重に数えない）
   ・× と未定の日には入れない。時間帯を選んだ日は、そのコマだけ
   ・○の人を先に入れ、足りない時だけ△の人を入れる
   ・週の回数／月の上限／連勤の上限を超えない
   ・人が少ないコマから先に埋める。同じ条件なら、希望の回数に対してまだ少ない人を優先（公平に）
*/
(function(root){
  'use strict';
  var SH = ['A','B','C','D'];
  var WDJ = ['日','月','火','水','木','金','土'];

  function dimOf(y, m){ return new Date(y, m, 0).getDate(); }
  function num(v){ var n = parseInt(String(v||'').replace(/[^0-9]/g,''), 10); return isNaN(n) ? null : n; }

  /* 「全体の希望」を上限の数字に直す */
  function capsOf(gen){
    gen = gen || {};
    var weekly = num(gen.weekly);                         // '3' → 3 / '他' → なし
    var monthly = num(gen.monthly);                       // '〜10' → 10
    var consec = /〜$/.test(String(gen.consec||'')) ? null : num(gen.consec);   // '7〜' は上限なし
    if(!gen.consec) consec = 6;                           // 書いていない人は6連勤まで（週1日の休み：労働基準法35条）
    var off = Array.isArray(gen.offdays) ? gen.offdays.map(function(w){ return WDJ.indexOf(w); }).filter(function(i){ return i >= 0; }) : [];
    return {weekly:weekly, monthly:monthly, consec:consec, off:off};
  }

  function context(o){
    var n = dimOf(o.y, o.m), lead = (new Date(o.y, o.m-1, 1).getDay() + 6) % 7;   // 月曜はじまりの週
    var req = {}; SH.forEach(function(k){ req[k] = Math.max(0, +((o.required||{})[k]) || 0); });
    var people = (o.requests||[]).map(function(r){
      var caps = capsOf(r.gen), avail = 0, d;
      for(d=1; d<=n; d++){ var x = r.days && r.days[d]; if(x && (x.s === 'o' || x.s === 't')) avail++; }
      var target = caps.monthly;
      if(caps.weekly != null){ var w = caps.weekly * n / 7; target = target == null ? w : Math.min(target, w); }
      return {uid:r.uid, name:r.name || '', days:r.days || {}, caps:caps, avail:avail, target:target};
    });
    var byUid = {}; people.forEach(function(p){ byUid[p.uid] = p; });
    return {y:o.y, m:o.m, n:n, req:req, people:people, byUid:byUid,
            wk:function(d){ return Math.floor((d - 1 + lead) / 7); },
            wd:function(d){ return new Date(o.y, o.m-1, d).getDay(); }};
  }

  /* その人が d日の k コマに入れるか：'o' / 't' / ''（入れない） */
  function wish(p, d, k){
    var x = p.days[d];
    if(!x || (x.s !== 'o' && x.s !== 't')) return '';
    if(x.sh && x.sh.length && x.sh.indexOf(k) < 0) return '';
    return x.s;
  }
  function picked(p, d){ var x = p.days[d]; return !!(x && x.sh && x.sh.length); }

  /* 割り当ての帳簿 */
  function ledger(ctx){
    var L = {};
    ctx.people.forEach(function(p){ L[p.uid] = {on:{}, total:0, week:{}}; });
    return {
      L: L,
      add: function(uid, d){ var l = L[uid]; if(!l) return; l.on[d] = true; l.total++; var w = ctx.wk(d); l.week[w] = (l.week[w]||0) + 1; },
      del: function(uid, d){ var l = L[uid]; if(!l || !l.on[d]) return; delete l.on[d]; l.total--; l.week[ctx.wk(d)]--; },
      run: function(uid, d){                                // d日に入れた時の連勤日数
        var l = L[uid], a = 1, i;
        for(i=d-1; i>=1 && l.on[i]; i--) a++;
        for(i=d+1; i<=ctx.n && l.on[i]; i++) a++;
        return a;
      }
    };
  }
  function fits(ctx, led, p, d){
    var l = led.L[p.uid], c = p.caps;
    if(l.on[d]) return false;
    if(c.monthly != null && l.total >= c.monthly) return false;
    if(c.weekly != null && (l.week[ctx.wk(d)]||0) >= c.weekly) return false;
    if(c.consec != null && led.run(p.uid, d) > c.consec) return false;
    return true;
  }
  function hash(s){ var h = 2166136261, i; for(i=0; i<s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  function planOnce(o, seed){
    var ctx = context(o), led = ledger(ctx), cells = {}, slots = [], d;
    for(d=1; d<=ctx.n; d++){
      cells[d] = {};
      SH.forEach(function(k){
        cells[d][k] = [];
        var need = ctx.req[k]; if(!need) return;
        var c = 0; ctx.people.forEach(function(p){ if(wish(p, d, k)) c++; });
        slots.push({d:d, k:k, need:need, slack:c - need, r:hash(seed+'/'+d+k)});
      });
    }
    /* 人が少ないコマから先に */
    slots.sort(function(a, b){ return a.slack - b.slack || b.need - a.need || (seed ? a.r - b.r : a.d - b.d) || SH.indexOf(a.k) - SH.indexOf(b.k); });

    function score(p, d, k){
      var w = wish(p, d, k), l = led.L[p.uid];
      var load = p.target ? l.total / p.target : l.total / Math.max(1, p.avail * 0.6);
      return [w === 'o' ? 0 : 1,                                   // ○ を先に
              p.caps.off.indexOf(ctx.wd(d)) >= 0 ? 1 : 0,          // 休み希望の曜日は後回し
              load,                                                // 希望回数に対して少ない人
              picked(p, d) ? 0 : 1,                                // このコマを選んだ人を先に（いつでもの人は融通が利く）
              hash(seed + ':' + p.uid + ':' + d + k) / 4294967296];             // 同点なら毎回同じ順で
    }
    function better(a, b){ for(var i=0; i<a.length; i++){ if(a[i] !== b[i]) return a[i] < b[i]; } return false; }

    slots.forEach(function(s){
      for(var seat=0; seat<s.need; seat++){
        var best = null, bs = null;
        ctx.people.forEach(function(p){
          if(!wish(p, s.d, s.k) || !fits(ctx, led, p, s.d)) return;
          var sc = score(p, s.d, s.k);
          if(!best || better(sc, bs)){ best = p; bs = sc; }
        });
        if(!best) break;
        cells[s.d][s.k].push(best.uid); led.add(best.uid, s.d);
      }
    });

    /* 組み替え：足りないコマに、同じ日の別のコマの人を回し、空いた所を別の人で埋める */
    for(d=1; d<=ctx.n; d++){
      SH.forEach(function(k){
        while(cells[d][k].length < ctx.req[k]){
          var moved = false;
          SH.some(function(k2){
            if(k2 === k) return false;
            return cells[d][k2].some(function(uid, idx){
              var p = ctx.byUid[uid]; if(!wish(p, d, k)) return false;
              var q = ctx.people.filter(function(q){ return wish(q, d, k2) && fits(ctx, led, q, d); })[0];
              if(!q) return false;
              cells[d][k2].splice(idx, 1, q.uid); led.add(q.uid, d);
              cells[d][k].push(uid);
              moved = true; return true;
            });
          });
          if(!moved) break;
        }
      });
    }

    /* 組み替え2：上限（週の回数・連勤）で入れない人を、別の日を他の人に代わってもらって入れる */
    function slotOf(uid, d){ return SH.filter(function(k){ return cells[d][k].indexOf(uid) >= 0; })[0]; }
    function fillByTrade(d, k){
      return ctx.people.some(function(p){
        if(!wish(p, d, k) || led.L[p.uid].on[d]) return false;
        return Object.keys(led.L[p.uid].on).map(Number).some(function(d2){
          var k2 = slotOf(p.uid, d2); if(!k2) return false;
          led.del(p.uid, d2);
          if(fits(ctx, led, p, d)){
            led.add(p.uid, d);
            var q = ctx.people.filter(function(q){ return q !== p && wish(q, d2, k2) && fits(ctx, led, q, d2); })
                              .sort(function(a, b){ return (wish(a, d2, k2) === 'o' ? 0 : 1) - (wish(b, d2, k2) === 'o' ? 0 : 1); })[0];
            if(q){
              var at = cells[d2][k2].indexOf(p.uid);
              cells[d2][k2].splice(at, 1, q.uid); led.add(q.uid, d2);
              cells[d][k].push(p.uid);
              return true;
            }
            led.del(p.uid, d);
          }
          led.add(p.uid, d2);
          return false;
        });
      });
    }
    for(var round=0; round<3; round++){
      var gained = false;
      for(d=1; d<=ctx.n; d++){
        SH.forEach(function(k){
          while(cells[d][k].length < ctx.req[k] && fillByTrade(d, k)) gained = true;
        });
      }
      if(!gained) break;
    }
    return cells;
  }

  /* 少しずつ順番を変えて何通りも組み、いちばん埋まった案を選ぶ（同じなら△が少なく、回数の偏りが小さい案） */
  function plan(o, tries){
    var best = null, bk = null, i, n = tries || 40;
    for(i=0; i<n; i++){
      var cells = planOnce(o, i), ev = evaluate(o, cells);
      var spread = 0; ev.people.forEach(function(p){ if(p.target) spread += Math.abs(p.count - p.target); });
      var key = [-ev.filled, ev.tri, spread];
      if(!best || key[0] < bk[0] || (key[0] === bk[0] && (key[1] < bk[1] || (key[1] === bk[1] && key[2] < bk[2])))){ best = cells; bk = key; }
    }
    return best;
  }

  /* 割り当て（自動でも手直し後でも）を点検して、数字と注意をまとめる */
  function evaluate(o, cells){
    var ctx = context(o), led = ledger(ctx), d, res = {n:ctx.n, short:0, shortSeats:0, tri:0, filled:0, seats:0, slots:{}, people:[], issues:[]};
    var perDay = {};
    for(d=1; d<=ctx.n; d++){
      res.slots[d] = {}; perDay[d] = {};
      SH.forEach(function(k){
        var list = (cells && cells[d] && cells[d][k]) || [], need = ctx.req[k], tri = 0;
        list.forEach(function(uid){
          var p = ctx.byUid[uid]; if(!p) return;
          if(perDay[d][uid]) res.issues.push({uid:uid, d:d, t:'同じ日に2コマ'});
          perDay[d][uid] = true; led.add(uid, d);
          var w = wish(p, d, k);
          if(w === 't') tri++;
          if(!w) res.issues.push({uid:uid, d:d, t:'希望外のコマ'});
        });
        var miss = Math.max(0, need - list.length);
        res.slots[d][k] = {list:list.slice(), need:need, miss:miss, tri:tri, st: !need ? (list.length ? 'ok' : 'n') : (miss ? 'ng' : (tri ? 'warn' : 'ok'))};
        res.seats += need; res.filled += Math.min(need, list.length); res.tri += tri;
        if(miss){ res.short++; res.shortSeats += miss; }
      });
    }
    ctx.people.forEach(function(p){
      var l = led.L[p.uid], c = p.caps, maxRun = 0, run = 0, wkOver = false;
      for(d=1; d<=ctx.n; d++){ run = l.on[d] ? run + 1 : 0; if(run > maxRun) maxRun = run; }
      Object.keys(l.week).forEach(function(w){ if(c.weekly != null && l.week[w] > c.weekly) wkOver = true; });
      if(c.consec != null && maxRun > c.consec) res.issues.push({uid:p.uid, t:c.consec+'連勤まで → '+maxRun+'連勤'});
      if(wkOver) res.issues.push({uid:p.uid, t:'週'+c.weekly+'回を超える週があります'});
      if(c.monthly != null && l.total > c.monthly) res.issues.push({uid:p.uid, t:'月'+c.monthly+'回まで → '+l.total+'回'});
      res.people.push({uid:p.uid, name:p.name, count:l.total, target:p.target == null ? null : Math.round(p.target), avail:p.avail, maxRun:maxRun});
    });
    return res;
  }

  /* 希望を素直に数えた場合（○も△も、1人を全部のコマに数える）。旧「集計」の「足りない」の数え方 */
  function naiveShort(o){
    var ctx = context(o), short = 0, d;
    for(d=1; d<=ctx.n; d++){
      SH.forEach(function(k){
        if(!ctx.req[k]) return;
        var c = 0; ctx.people.forEach(function(p){ if(wish(p, d, k)) c++; });
        if(c < ctx.req[k]) short++;
      });
    }
    return short;
  }

  /* その人が入れる（希望している）か。手直しの候補を出すのに使う */
  function candidates(o, cells, d, k){
    var ctx = context(o), led = ledger(ctx), dd;
    for(dd=1; dd<=ctx.n; dd++) SH.forEach(function(kk){ ((cells[dd]||{})[kk]||[]).forEach(function(uid){ led.add(uid, dd); }); });
    var here = (cells[d] && cells[d][k]) || [];
    return ctx.people.filter(function(p){ return here.indexOf(p.uid) < 0; }).map(function(p){
      var w = wish(p, d, k), busy = SH.filter(function(kk){ return ((cells[d]||{})[kk]||[]).indexOf(p.uid) >= 0; })[0] || '';
      return {uid:p.uid, name:p.name, wish:w, busy:busy, fits: !busy && fits(ctx, led, p, d), count:led.L[p.uid].total, target:p.target == null ? null : Math.round(p.target)};
    }).filter(function(c){ return c.wish; }).sort(function(a, b){
      return (b.fits - a.fits) || ((a.wish === 'o' ? 0 : 1) - (b.wish === 'o' ? 0 : 1)) || (a.count - b.count);
    });
  }

  var api = {SH:SH, plan:plan, evaluate:evaluate, naiveShort:naiveShort, candidates:candidates, capsOf:capsOf};
  if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.ShiftPlanner = api;
})(this);
