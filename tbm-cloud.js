/* Task by Moody — versione app.
   Collega l'app a Supabase (accesso, dati sincronizzati, notifiche) offrendo
   la stessa interfaccia "window.claude.use('db')" che l'app usa dentro Claude. */
(function () {
  'use strict';
  var SB_URL = 'https://ureljyilauscbhhlwcep.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyZWxqeWlsYXVzY2JoaGx3Y2VwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MjIyNTksImV4cCI6MjEwODA5ODI1OX0.hVegSO4drVvjjYl3HCFzVgLIFh9HYCHql2zUbqfj5Gs';
  var VAPID = 'BEWv6QFhEBInRNQCg65TMk0taWTD1HvJfFIC2MNXGCGinaDKkjhPp9e-82CjfvXUsWLsSU663dxuJFcBArdUHAY';
  var COLLS = ['clients', 'projects', 'tasks', 'blocks', 'settings'];

  var sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'tbm-auth' } });
  var uid = null, email = '';
  var cache = {}; COLLS.forEach(function (c) { cache[c] = {}; });
  var listeners = {}; COLLS.forEach(function (c) { listeners[c] = []; });
  var docListeners = [];
  var loaded = false, pending = {}, emitT = {};
  var readyResolve; var ready = new Promise(function (r) { readyResolve = r; });

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var outbox = lsGet('tbm-outbox', {});
  var saveCacheT = null;
  function saveCache() { clearTimeout(saveCacheT); saveCacheT = setTimeout(function () { lsSet('tbm-cache', { uid: uid, cache: cache }); }, 800); }

  /* ---------- istantanee come le aspetta l'app ---------- */
  function snap(c) { return { docs: Object.keys(cache[c]).map(function (id) { var d = cache[c][id]; return { id: id, exists: true, data: function () { return d; } }; }) }; }
  function emit(c) {
    clearTimeout(emitT[c]);
    emitT[c] = setTimeout(function () {
      if (c === 'settings') { var m = cache.settings.main; docListeners.forEach(function (cb) { cb({ exists: !!m, data: function () { return m; } }); }); }
      else listeners[c].forEach(function (cb) { cb(snap(c)); });
    }, 30);
  }
  function emitAll() { COLLS.forEach(emit); }

  /* ---------- scrittura (con coda se sei offline) ---------- */
  function isNetErr(e) { return !e || !e.code || e.message === 'Failed to fetch' || /fetch|network/i.test(String(e.message || e)); }
  function send(c, id, data) {
    var q = data === null
      ? sb.from('docs').delete().eq('user_id', uid).eq('coll', c).eq('id', id)
      : sb.from('docs').upsert({ user_id: uid, coll: c, id: id, data: data, updated_at: new Date().toISOString() });
    return q.then(function (r) { if (r.error) throw r.error; });
  }
  function write(c, id, data) {
    var k = c + '/' + id;
    if (data === null) delete cache[c][id]; else cache[c][id] = data;
    saveCache();
    pending[k] = (pending[k] || 0) + 1;
    return send(c, id, data).then(function () { delete outbox[k]; lsSet('tbm-outbox', outbox); },
      function (e) {
        if (isNetErr(e)) { outbox[k] = { c: c, id: id, data: data }; lsSet('tbm-outbox', outbox); setNet(false); return; }
        throw { code: 'write_failed', message: e.message };
      }).finally(function () { pending[k]--; if (!pending[k]) delete pending[k]; });
  }
  var flushing = false;
  function flushOutbox() {
    if (flushing || !uid) return Promise.resolve();
    var keys = Object.keys(outbox); if (!keys.length) return Promise.resolve();
    flushing = true;
    return keys.reduce(function (p, k) {
      return p.then(function () { var o = outbox[k]; if (!o) return; return send(o.c, o.id, o.data).then(function () { delete outbox[k]; lsSet('tbm-outbox', outbox); setNet(true); }); });
    }, Promise.resolve()).catch(function () { setNet(false); }).finally(function () { flushing = false; });
  }
  function setNet(ok) {
    var el = document.getElementById('status'); if (!el || !el.lastElementChild) return;
    if (!ok) { el.className = 'status err'; el.lastElementChild.textContent = 'Offline: salvo quando torna la rete'; }
    else if (/Offline/.test(el.lastElementChild.textContent)) { el.className = 'status cloud'; el.lastElementChild.textContent = 'Sincronizzato'; }
  }

  /* ---------- lettura completa + tempo reale ---------- */
  function loadAll() {
    var all = [], from = 0, size = 1000;
    function page() {
      return sb.from('docs').select('coll,id,data').eq('user_id', uid).range(from, from + size - 1).then(function (r) {
        if (r.error) throw r.error;
        all = all.concat(r.data); if (r.data.length === size) { from += size; return page(); }
      });
    }
    return page().then(function () {
      var next = {}; COLLS.forEach(function (c) { next[c] = {}; });
      all.forEach(function (row) { if (next[row.coll]) next[row.coll][row.id] = row.data; });
      // le modifiche ancora in viaggio o in coda vincono su quello che arriva dal server
      Object.keys(pending).concat(Object.keys(outbox)).forEach(function (k) {
        var i = k.indexOf('/'), c = k.slice(0, i), id = k.slice(i + 1);
        if (!next[c]) return;
        if (outbox[k]) { if (outbox[k].data === null) delete next[c][id]; else next[c][id] = outbox[k].data; }
        else if (cache[c][id] !== undefined) next[c][id] = cache[c][id]; else delete next[c][id];
      });
      COLLS.forEach(function (c) { if (JSON.stringify(next[c]) !== JSON.stringify(cache[c])) { cache[c] = next[c]; emit(c); } });
      if (!loaded) { loaded = true; emitAll(); }
      saveCache(); setNet(true);
    });
  }
  function onRow(p) {
    var row = p.eventType === 'DELETE' ? p.old : p.new;
    if (!row || (row.user_id && row.user_id !== uid) || !cache[row.coll]) return;
    var k = row.coll + '/' + row.id;
    if (pending[k] || outbox[k]) return;
    if (p.eventType === 'DELETE') { if (!(row.id in cache[row.coll])) return; delete cache[row.coll][row.id]; }
    else { if (JSON.stringify(cache[row.coll][row.id]) === JSON.stringify(row.data)) return; cache[row.coll][row.id] = row.data; }
    saveCache(); emit(row.coll);
  }
  var channel = null;
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('docs-' + uid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'docs', filter: 'user_id=eq.' + uid }, onRow)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'docs', filter: 'user_id=eq.' + uid }, onRow)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'docs' }, onRow)
      .subscribe();
  }
  function resync() { if (!uid) return; flushOutbox().then(loadAll).catch(function () { setNet(false); }); }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { resync(); if (!channel || channel.state !== 'joined') subscribe(); } });
  window.addEventListener('online', resync);
  setInterval(function () { if (Object.keys(outbox).length) flushOutbox(); }, 30000);

  /* ---------- interfaccia "db" che l'app usa ---------- */
  var dbApi = {
    collection: function (c) {
      return {
        onSnapshot: function (cb) { listeners[c].push(cb); if (loaded) cb(snap(c)); return function () {}; },
        doc: function (id) { return { set: function (o) { return write(c, id, JSON.parse(JSON.stringify(o))); }, delete: function () { return write(c, id, null); } }; }
      };
    },
    doc: function (path) {
      var parts = path.split('/'), c = parts[0], id = parts[1];
      return {
        onSnapshot: function (cb) { docListeners.push(cb); if (loaded) { var m = cache.settings.main; cb({ exists: !!m, data: function () { return m; } }); } return function () {}; },
        set: function (o) { return write(c, id, JSON.parse(JSON.stringify(o))); }
      };
    }
  };
  var downloads = {
    save: function (o) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(o.data); a.download = o.filename;
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      return Promise.resolve();
    }
  };
  window.claude = { use: function (n) { return n === 'db' ? ready : n === 'downloads' ? Promise.resolve(downloads) : Promise.resolve(null); } };

  /* ---------- promemoria → server ---------- */
  var hasSubs = false, remBusy = null, remLast = null;
  function kickReminders() { if (!hasSubs) return; if (remLast) window.tbmReminders(remLast); else if (window.tbmForceReminders) window.tbmForceReminders(); }
  window.tbmReminders = function (list) {
    remLast = list;
    if (!uid || !hasSubs) return;
    if (remBusy) return;
    remBusy = (function run() {
      var want = remLast; remLast = null;
      return sb.from('reminders').select('id,at,title,body').eq('user_id', uid).is('sent_at', null).gte('at', new Date().toISOString())
        .then(function (r) {
          if (r.error) throw r.error;
          var have = {}; r.data.forEach(function (x) { have[x.id] = x; });
          var wantIds = {}; want.forEach(function (x) { wantIds[x.id] = 1; });
          var del = r.data.filter(function (x) { return !wantIds[x.id]; }).map(function (x) { return x.id; });
          var up = want.filter(function (x) { var h = have[x.id]; return !h || new Date(h.at).getTime() !== new Date(x.at).getTime() || h.title !== x.title || (h.body || '') !== x.body; })
            .map(function (x) { return { user_id: uid, id: x.id, at: x.at, title: x.title, body: x.body }; });
          var ps = [];
          if (del.length) ps.push(sb.from('reminders').delete().eq('user_id', uid).is('sent_at', null).in('id', del));
          if (up.length) ps.push(sb.from('reminders').upsert(up));
          return Promise.all(ps);
        })
        .catch(function (e) { console.warn('promemoria', e); })
        .then(function () { if (remLast) return run(); });
    })().finally(function () { remBusy = null; });
  };

  /* ---------- notifiche ---------- */
  function b64ToBytes(s) { var p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var swReg = null;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').then(function (r) { swReg = r; }).catch(function (e) { console.warn('sw', e); });
  function supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function getReg() { return swReg ? Promise.resolve(swReg) : navigator.serviceWorker.ready; }
  function saveSub(sub) {
    return sb.from('push_subs').upsert({ endpoint: sub.endpoint, user_id: uid, sub: sub.toJSON(), device: (isIOS ? 'iPhone ' : '') + navigator.userAgent.slice(0, 100) })
      .then(function (r) { if (r.error) throw r.error; hasSubs = true; });
  }
  window.tbmPush = {
    email: function () { return email; },
    status: function () {
      if (isIOS && !standalone) return Promise.resolve('install');
      if (!supported()) return Promise.resolve('unsupported');
      if (Notification.permission === 'denied') return Promise.resolve('denied');
      return getReg().then(function (r) { return r.pushManager.getSubscription(); }).then(function (s) { return s && Notification.permission === 'granted' ? 'on' : 'off'; }).catch(function () { return 'off'; });
    },
    enable: function () {
      if (!supported()) return Promise.resolve('unsupported');
      return Notification.requestPermission().then(function (p) {
        if (p !== 'granted') return p === 'denied' ? 'denied' : 'Permesso non concesso';
        return getReg().then(function (r) { return r.pushManager.getSubscription().then(function (s) { return s || r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) }); }); })
          .then(saveSub).then(function () { kickReminders(); return 'on'; })
          .catch(function (e) { return 'Errore: ' + (e && e.message || e); });
      });
    },
    test: function () {
      return sb.from('reminders').upsert({ user_id: uid, id: 'test:' + Date.now(), at: new Date().toISOString(), title: '🔔 Notifiche attive', body: 'Funziona! Ti avviso così prima di eventi e attività.' });
    },
    signOut: function () { try { localStorage.removeItem('tbm-cache'); localStorage.removeItem('tbm-outbox'); } catch (e) {} sb.auth.signOut().finally(function () { location.reload(); }); }
  };

  /* ---------- accesso ---------- */
  function start(session) {
    if (uid) return;
    uid = session.user.id; email = session.user.email || '';
    hideGate();
    var c = lsGet('tbm-cache', null);
    if (c && c.uid === uid && c.cache) { COLLS.forEach(function (k) { cache[k] = c.cache[k] || {}; }); loaded = true; emitAll(); }
    readyResolve(dbApi);
    loadAll().catch(function () { setNet(false); if (!loaded) { loaded = true; emitAll(); } });
    flushOutbox(); subscribe();
    sb.from('push_subs').select('endpoint').eq('user_id', uid).limit(1).then(function (r) { hasSubs = !!(r.data && r.data.length); kickReminders(); });
    // tiene aggiornata l'iscrizione di questo dispositivo
    if (supported() && Notification.permission === 'granted') getReg().then(function (r) { return r.pushManager.getSubscription(); }).then(function (s) { if (s) saveSub(s); }).catch(function () {});
  }
  sb.auth.onAuthStateChange(function (ev, session) { if (session && !uid) start(session); });
  sb.auth.getSession().then(function (r) { if (r.data && r.data.session) start(r.data.session); else showGate(); });

  var gate = null;
  function hideGate() { if (gate) { gate.classList.add('out'); setTimeout(function () { gate && gate.remove(); gate = null; }, 300); } }
  function showGate() {
    if (gate) return;
    var css = document.createElement('style');
    css.textContent = '#tbmGate{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:var(--bg,#f5f5f7);font-family:Figtree,system-ui,sans-serif;transition:opacity .3s}' +
      '#tbmGate.out{opacity:0}#tbmGate .g{width:100%;max-width:360px;background:var(--surface,#fff);border-radius:22px;padding:28px 24px;box-shadow:0 20px 60px rgb(0 0 0/.12)}' +
      '#tbmGate h1{margin:0 0 4px;font-size:28px;letter-spacing:-.02em}#tbmGate h1 small{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#888);margin-left:6px}' +
      '#tbmGate p{margin:0 0 18px;color:var(--muted,#777);font-size:14px}#tbmGate label{display:block;font-size:12px;font-weight:700;color:var(--muted,#777);margin:12px 0 4px}' +
      '#tbmGate input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:11px 12px;border-radius:12px;border:1px solid var(--line,#ddd);background:var(--surface-2,#f7f7f9);color:inherit}' +
      '#tbmGate button{width:100%;margin-top:16px;font:inherit;font-weight:700;font-size:16px;padding:12px;border:0;border-radius:12px;background:var(--accent,#0a84ff);color:#fff;cursor:pointer}' +
      '#tbmGate button.alt{background:none;color:var(--accent,#0a84ff);margin-top:8px;font-size:14px}#tbmGate .msg{margin-top:12px;font-size:13px;color:var(--muted,#666);min-height:1em}#tbmGate .msg.err{color:#e5484d}';
    document.head.appendChild(css);
    gate = document.createElement('div'); gate.id = 'tbmGate';
    gate.innerHTML = '<form class="g" novalidate><h1>Task<small>by Moody</small></h1><p id="tgSub">Accedi per vedere i tuoi impegni su tutti i dispositivi.</p>' +
      '<label for="tgE">Email</label><input id="tgE" type="email" autocomplete="username" required>' +
      '<label for="tgP">Password</label><input id="tgP" type="password" autocomplete="current-password" minlength="6" required>' +
      '<button type="submit" id="tgGo">Accedi</button><button type="button" class="alt" id="tgSw">Prima volta? Crea l’account</button><div class="msg" id="tgMsg"></div></form>';
    var mount = function () { document.body.appendChild(gate); };
    if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
    var signup = false, $ = function (id) { return gate.querySelector('#' + id); };
    function msg(t, err) { var m = $('tgMsg'); m.textContent = t; m.className = 'msg' + (err ? ' err' : ''); }
    $('tgSw').onclick = function () { signup = !signup; $('tgGo').textContent = signup ? 'Crea account' : 'Accedi'; $('tgSw').textContent = signup ? 'Ho già un account: accedi' : 'Prima volta? Crea l’account'; $('tgSub').textContent = signup ? 'Scegli email e password (almeno 6 caratteri).' : 'Accedi per vedere i tuoi impegni su tutti i dispositivi.'; $('tgP').autocomplete = signup ? 'new-password' : 'current-password'; msg(''); };
    gate.querySelector('form').onsubmit = function (e) {
      e.preventDefault();
      var em = $('tgE').value.trim(), pw = $('tgP').value;
      if (!em || pw.length < 6) { msg('Scrivi email e una password di almeno 6 caratteri.', 1); return; }
      $('tgGo').disabled = true; msg(signup ? 'Creo l’account…' : 'Accesso…');
      var p = signup ? sb.auth.signUp({ email: em, password: pw, options: { emailRedirectTo: location.origin + location.pathname } }) : sb.auth.signInWithPassword({ email: em, password: pw });
      p.then(function (r) {
        $('tgGo').disabled = false;
        if (r.error) {
          var m = r.error.message || '';
          msg(/Invalid login/i.test(m) ? 'Email o password sbagliate.' : /not confirmed/i.test(m) ? 'Account non ancora confermato: apri il link nella mail di conferma (o chiedi a Claude di attivarlo).' : /registered|exists/i.test(m) ? 'Questa email ha già un account: accedi.' : /Database error|not allowed/i.test(m) ? 'Le registrazioni sono chiuse: questa app è personale.' : 'Errore: ' + m, 1);
          return;
        }
        if (signup && !r.data.session) { msg('Account creato! Conferma dal link che ti è arrivato via email, poi torna qui e accedi.'); signup = true; $('tgSw').click(); }
      });
    };
  }
})();
