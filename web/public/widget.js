/*! Website widget: chat and click-to-call with an AI agent.
 * Embed: <script src="https://YOUR-APP/widget.js" data-widget="wpk_..." async></script>
 * Everything renders inside a shadow root, so the host page's CSS can't break it (and vice versa).
 * Messages are always inserted as text, never HTML. */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) return;
  var KEY = script.getAttribute("data-widget");
  var BASE = new URL(script.src).origin;
  window.__aiWidgets = window.__aiWidgets || {};
  if (!KEY || window.__aiWidgets[KEY]) return;
  window.__aiWidgets[KEY] = true;
  var API = BASE + "/api/widget/" + encodeURIComponent(KEY);
  var STORE = "aiw:" + KEY;

  function post(path, body) {
    return fetch(API + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
        return j;
      });
    });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function load() {
    try { return JSON.parse(sessionStorage.getItem(STORE) || "null"); } catch (e) { return null; }
  }
  function save(v) {
    try { sessionStorage.setItem(STORE, JSON.stringify(v)); } catch (e) { /* private mode */ }
  }

  fetch(API + "/config").then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
    if (cfg) build(cfg);
  }).catch(function () {});

  function build(cfg) {
    var a = cfg.appearance || {};
    var host = el("div");
    host.style.cssText = "position:fixed;z-index:2147483000;bottom:20px;" + (a.position === "left" ? "left:20px;" : "right:20px;");
    var root = host.attachShadow({ mode: "open" });
    var style = el("style");
    style.textContent =
      ":host{all:initial}*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}" +
      ".launch{display:flex;align-items:center;gap:8px;height:56px;min-width:56px;padding:0 18px;border:0;border-radius:28px;background:var(--c);color:#fff;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.2)}" +
      ".launch svg{width:24px;height:24px}.launch:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid var(--c);outline-offset:2px}" +
      ".panel{position:absolute;bottom:72px;" + (a.position === "left" ? "left:0" : "right:0") + ";width:min(380px,calc(100vw - 40px));height:min(580px,calc(100vh - 120px));display:none;flex-direction:column;background:#fff;color:#171717;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.25);overflow:hidden}" +
      ".panel.open{display:flex}.head{background:var(--c);color:#fff;padding:16px 18px;display:flex;justify-content:space-between;gap:12px}" +
      ".head h2{margin:0;font-size:16px}.head p{margin:2px 0 0;font-size:13px;opacity:.85}.x{background:transparent;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer}" +
      ".tabs{display:flex;gap:6px;padding:10px 12px 0}.tab{flex:1;padding:8px;border:1px solid #e5e7eb;border-radius:999px;background:#fff;font-size:13px;cursor:pointer;color:#374151}.tab[aria-selected=true]{border-color:var(--c);color:var(--c);font-weight:600}" +
      ".view{flex:1;display:none;flex-direction:column;min-height:0}.view.on{display:flex}" +
      ".log{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px}" +
      ".m{max-width:85%;padding:9px 12px;border-radius:14px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}" +
      ".a{background:#f3f4f6;align-self:flex-start}.u{background:var(--c);color:#fff;align-self:flex-end}.t{color:#6b7280;font-size:13px}" +
      ".err{color:#b91c1c;font-size:13px;padding:0 14px 6px}" +
      "form{display:flex;gap:8px;padding:10px;border-top:1px solid #e5e7eb}input{flex:1;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;color:#171717;background:#fff}" +
      ".send{border:0;border-radius:10px;background:var(--c);color:#fff;padding:0 14px;font-weight:600;cursor:pointer}.send:disabled{opacity:.5}" +
      ".call{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:18px;text-align:center}" +
      ".dial{width:84px;height:84px;border-radius:50%;border:0;background:var(--c);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.18)}.dial svg{width:34px;height:34px}.dial.end{background:#dc2626}" +
      ".dial.live{animation:p 1.6s infinite}@keyframes p{0%{box-shadow:0 0 0 0 rgba(0,0,0,.25)}70%{box-shadow:0 0 0 16px rgba(0,0,0,0)}100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}}" +
      ".status{font-size:14px;color:#374151}.clog{width:100%;max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px}" +
      ".foot{text-align:center;font-size:11px;color:#9ca3af;padding:6px}" +
      "@media (prefers-color-scheme:dark){.panel{background:#18181b;color:#ededed}.a{background:#27272a}.tab{background:#18181b;border-color:#3f3f46;color:#d4d4d8}form{border-color:#3f3f46}input{background:#27272a;border-color:#3f3f46;color:#ededed}.status{color:#d4d4d8}}" +
      "@media (prefers-reduced-motion:reduce){.dial.live{animation:none}}";
    root.appendChild(style);
    host.style.setProperty("--c", /^#[0-9a-f]{6}$/i.test(a.color || "") ? a.color : "#2563eb");

    var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
    var ICON_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>';

    var launch = el("button", "launch");
    launch.type = "button";
    launch.setAttribute("aria-label", a.launcherLabel || a.title || "Open chat");
    launch.innerHTML = cfg.mode === "voice" ? ICON_PHONE : ICON_CHAT; // static icons only
    if (a.launcherLabel) launch.appendChild(el("span", null, a.launcherLabel));
    launch.setAttribute("aria-expanded", "false");

    var panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", a.title || "Chat");
    var head = el("div", "head");
    var titles = el("div");
    titles.appendChild(el("h2", null, a.title || "Chat with us"));
    if (a.subtitle) titles.appendChild(el("p", null, a.subtitle));
    var close = el("button", "x", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    head.appendChild(titles);
    head.appendChild(close);
    panel.appendChild(head);

    var views = {};
    var tabs = {};
    if (cfg.mode === "both") {
      var bar = el("div", "tabs");
      bar.setAttribute("role", "tablist");
      ["chat", "call"].forEach(function (id) {
        var t = el("button", "tab", id === "chat" ? "Chat" : "Call");
        t.type = "button";
        t.setAttribute("role", "tab");
        t.onclick = function () { show(id); };
        tabs[id] = t;
        bar.appendChild(t);
      });
      panel.appendChild(bar);
    }
    if (cfg.mode !== "voice") views.chat = chatView();
    if (cfg.mode !== "chat") views.call = callView();
    Object.keys(views).forEach(function (k) { panel.appendChild(views[k].node); });
    if (cfg.poweredBy) panel.appendChild(el("div", "foot", "Powered by " + cfg.poweredBy));

    function show(id) {
      Object.keys(views).forEach(function (k) {
        views[k].node.classList.toggle("on", k === id);
        if (tabs[k]) tabs[k].setAttribute("aria-selected", String(k === id));
      });
      if (views[id].onShow) views[id].onShow();
    }
    show(cfg.mode === "voice" ? "call" : "chat");

    function setOpen(open) {
      panel.classList.toggle("open", open);
      launch.setAttribute("aria-expanded", String(open));
      if (open) {
        var active = views.chat && views.chat.node.classList.contains("on") ? views.chat : views.call;
        if (active.onShow) active.onShow();
      } else launch.focus();
    }
    launch.onclick = function () { setOpen(!panel.classList.contains("open")); };
    close.onclick = function () { setOpen(false); };
    root.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });

    root.appendChild(panel);
    root.appendChild(launch);
    document.body.appendChild(host);

    function chatView() {
      var node = el("div", "view");
      var log = el("div", "log");
      log.setAttribute("aria-live", "polite");
      var err = el("div", "err");
      var form = el("form");
      var input = el("input");
      input.placeholder = "Type a message…";
      input.maxLength = 2000;
      input.setAttribute("aria-label", "Message");
      var send = el("button", "send", "Send");
      send.type = "submit";
      form.appendChild(input);
      form.appendChild(send);
      node.appendChild(log);
      node.appendChild(err);
      node.appendChild(form);
      var state = load();
      var starting = null;

      function add(role, text) {
        var m = el("div", "m " + (role === "user" ? "u" : "a"), text);
        log.appendChild(m);
        log.scrollTop = log.scrollHeight;
        return m;
      }
      function start() {
        if (state && state.sessionId) return Promise.resolve(state);
        if (!starting) {
          starting = post("/chat", { page: location.href }).then(function (s) {
            state = { sessionId: s.sessionId, token: s.token, messages: [{ role: "assistant", text: s.greeting }] };
            save(state);
            add("assistant", s.greeting);
            return state;
          }).finally(function () { starting = null; });
        }
        return starting;
      }
      if (state && state.messages) state.messages.forEach(function (m) { add(m.role, m.text); });
      else if (cfg.greeting) add("assistant", cfg.greeting);

      form.onsubmit = function (e) {
        e.preventDefault();
        var text = input.value.trim();
        if (!text) return;
        input.value = "";
        err.textContent = "";
        if (!state) log.textContent = "";
        send.disabled = true;
        start().then(function (s) {
          add("user", text);
          var typing = add("assistant", "…");
          typing.classList.add("t");
          return post("/chat/" + s.sessionId, { token: s.token, text: text }).then(function (r) {
            typing.remove();
            add("assistant", r.reply);
            s.messages.push({ role: "user", text: text }, { role: "assistant", text: r.reply });
            save(s);
          }, function (e2) {
            typing.remove();
            if (/expired/i.test(e2.message)) { state = null; save(null); }
            err.textContent = e2.message;
          });
        }, function (e3) { err.textContent = e3.message; }).finally(function () {
          send.disabled = false;
          input.focus();
        });
      };
      return { node: node, onShow: function () { setTimeout(function () { input.focus(); }, 0); } };
    }

    function callView() {
      var node = el("div", "view");
      var box = el("div", "call");
      var status = el("div", "status", "Talk to us now, right from your browser.");
      status.setAttribute("aria-live", "polite");
      var dial = el("button", "dial");
      dial.type = "button";
      dial.innerHTML = ICON_PHONE;
      dial.setAttribute("aria-label", "Start call");
      var clog = el("div", "clog");
      box.appendChild(dial);
      box.appendChild(status);
      box.appendChild(clog);
      node.appendChild(box);
      var room = null;
      var busy = false;

      function lk() {
        if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
        return new Promise(function (resolve, reject) {
          var s = document.createElement("script");
          s.src = BASE + "/widget/livekit-client.umd.js";
          s.onload = function () { resolve(window.LivekitClient); };
          s.onerror = function () { reject(new Error("Couldn't load the call client.")); };
          document.head.appendChild(s);
        });
      }
      function reset(msg) {
        room = null;
        busy = false;
        dial.classList.remove("end", "live");
        dial.setAttribute("aria-label", "Start call");
        status.textContent = msg || "Call ended. Tap to call again.";
        root.querySelectorAll("audio").forEach(function (a2) { a2.remove(); });
      }
      function line(who, text) {
        var m = el("div", "m " + (who === "you" ? "u" : "a"), text);
        clog.appendChild(m);
        clog.scrollTop = clog.scrollHeight;
      }
      dial.onclick = function () {
        if (busy) return;
        if (room) { room.disconnect(); return; }
        busy = true;
        status.textContent = "Connecting…";
        clog.textContent = "";
        Promise.all([lk(), post("/call")]).then(function (r) {
          var L = r[0], cred = r[1];
          room = new L.Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          room.on(L.RoomEvent.TrackSubscribed, function (track) {
            if (track.kind === "audio") { var audio = track.attach(); audio.style.display = "none"; root.appendChild(audio); }
          });
          room.on(L.RoomEvent.Disconnected, function () { reset(); });
          if (room.registerTextStreamHandler) {
            room.registerTextStreamHandler("lk.transcription", function (reader, participant) {
              reader.readAll().then(function (text) {
                if (text && text.trim()) line(participant.identity === room.localParticipant.identity ? "you" : "agent", text.trim());
              }).catch(function () {});
            });
          }
          return room.connect(cred.url, cred.token).then(function () { return room.localParticipant.setMicrophoneEnabled(true); });
        }).then(function () {
          busy = false;
          dial.classList.add("end", "live");
          dial.setAttribute("aria-label", "End call");
          status.textContent = "You're connected. Start talking.";
        }).catch(function (e) {
          if (room) room.disconnect();
          reset(/permission|notallowed/i.test(String(e && (e.name || e.message))) ? "Allow microphone access to call." : e.message || "The call couldn't start.");
        });
      };
      return { node: node };
    }
  }
})();
