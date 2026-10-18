// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/5/LICENSE

// Open simple dialogs on top of an editor. Relies on dialog.css.

(function(mod) {
  if (typeof exports == "object" && typeof module == "object")
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd)
    define(["../../lib/codemirror"], mod);
  else
    mod(CodeMirror);
})(function(CodeMirror) {
  function dialogDiv(cm, template, bottom) {
    var wrap = cm.getWrapperElement();
    var dialog;
    dialog = wrap.appendChild(document.createElement("div"));
    if (bottom)
      dialog.className = "CodeMirror-dialog CodeMirror-dialog-bottom";
    else
      dialog.className = "CodeMirror-dialog CodeMirror-dialog-top";

    if (typeof template == "string") {
      dialog.innerHTML = template;
    } else {
      dialog.appendChild(template);
    }
    CodeMirror.addClass(wrap, 'dialog-opened');
    return dialog;
  }

  function closeNotification(cm, newVal) {
    if (cm.state.currentNotificationClose)
      cm.state.currentNotificationClose();
    cm.state.currentNotificationClose = newVal;
  }

  CodeMirror.defineExtension("openDialog", function(template, callback, options) {
    if (!options) options = {};
    closeNotification(this, null);
    var dialog = dialogDiv(this, template, options.bottom);
    var closed = false, me = this;
    function close(newVal) {
      if (typeof newVal == 'string') {
        inp.value = newVal;
      } else {
        if (closed) return;
        closed = true;
        CodeMirror.rmClass(dialog.parentNode, 'dialog-opened');
        dialog.parentNode.removeChild(dialog);
        me.focus();
        if (options.onClose) options.onClose(dialog);
      }
    }

    var inp = dialog.getElementsByTagName("input")[0], button;
    if (inp) {
      inp.focus();
      if (options.value) {
        inp.value = options.value;
        if (options.selectValueOnOpen !== false) inp.select();
      }
      if (options.onInput)
        CodeMirror.on(inp, "input", function(e) { options.onInput(e, inp.value, close);});
      if (options.onKeyUp)
        CodeMirror.on(inp, "keyup", function(e) {options.onKeyUp(e, inp.value, close);});
      CodeMirror.on(inp, "keydown", function(e) {
        if (options && options.onKeyDown && options.onKeyDown(e, inp.value, close)) return;
        if (e.keyCode == 27 || (options.closeOnEnter !== false && e.keyCode == 13)) {
          inp.blur();
          CodeMirror.e_stop(e);
          close();
        }
        if (e.keyCode == 13) callback(inp.value, e);
      });
      if (options.closeOnBlur !== false) CodeMirror.on(dialog, "focusout", function (evt) {
        if (evt.relatedTarget !== null) close();
      });
    } else if (button = dialog.getElementsByTagName("button")[0]) {
      CodeMirror.on(button, "click", function() { close(); me.focus(); });
      if (options.closeOnBlur !== false) CodeMirror.on(button, "blur", close);
      button.focus();
    }
    return close;
  });

  CodeMirror.defineExtension("openConfirm", function(template, callbacks, options) {
    closeNotification(this, null);
    var dialog = dialogDiv(this, template, options && options.bottom);
    var buttons = dialog.getElementsByTagName("button");
    var closed = false, me = this, blurring = 1;
    function close() {
      if (closed) return;
      closed = true;
      CodeMirror.rmClass(dialog.parentNode, 'dialog-opened');
      dialog.parentNode.removeChild(dialog);
      me.focus();
    }
    buttons[0].focus();
    for (var i = 0; i < buttons.length; ++i) {
      var b = buttons[i];
      (function(callback) {
        CodeMirror.on(b, "click", function(e) {
          CodeMirror.e_preventDefault(e);
          close();
          if (callback) callback(me);
        });
      })(callbacks[i]);
      CodeMirror.on(b, "blur", function() {
        --blurring;
        setTimeout(function() { if (blurring <= 0) close(); }, 200);
      });
      CodeMirror.on(b, "focus", function() { ++blurring; });
    }
  });

  CodeMirror.defineExtension("openNotification", function(template, options) {
    closeNotification(this, close);
    var dialog = dialogDiv(this, template, options && options.bottom);
    var closed = false, doneTimer;
    var duration = options && typeof options.duration !== "undefined" ? options.duration : 5000;
    function close() {
      if (closed) return;
      closed = true;
      clearTimeout(doneTimer);
      CodeMirror.rmClass(dialog.parentNode, 'dialog-opened');
      dialog.parentNode.removeChild(dialog);
    }
    CodeMirror.on(dialog, 'click', function(e) {
      CodeMirror.e_preventDefault(e);
      close();
    });
    if (duration) doneTimer = setTimeout(close, duration);
    return close;
  });
});

// MyFa Host Telegram Serverless compatibility bridge.
// The existing Vercel UI uses fetch('/api/...'). Serverless Mini Apps should call
// Telegram.WebApp.Serverless.call(), so we transparently translate those calls.
(function () {
  if (typeof window === 'undefined' || !window.Telegram || !Telegram.WebApp) return;
  if (!Telegram.WebApp.Serverless || !Telegram.WebApp.Serverless.call) return;
  if (window.__MYFA_SERVERLESS_FETCH__) return;

  const nativeFetch = window.fetch.bind(window);
  const originalFetch = window.fetch;

  function jsonResponse(value, status) {
    const body = JSON.stringify(value);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
      url: '',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => value,
      text: async () => body,
      clone: function () { return jsonResponse(value, status); }
    };
  }

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.startsWith('/api/')) return nativeFetch(input, init);

    const parsed = new URL(url, window.location.origin);
    const path = parsed.pathname.replace(/^\/api\//, '');
    const method = String((init && init.method) || 'GET').toUpperCase();
    let body = null;

    if (init && init.body) {
      try { body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body; }
      catch (_) { body = init.body; }
    }

    const query = {};
    parsed.searchParams.forEach((value, key) => { query[key] = value; });

    return new Promise(function (resolve) {
      Telegram.WebApp.Serverless.call('legacyApi', {
        path,
        method,
        query,
        body
      }, function (error, result) {
        if (error) {
          resolve(jsonResponse({ error: error.message, type: error.type }, error.status || 500));
          return;
        }
        resolve(jsonResponse(result, 200));
      });
    });
  };

  window.__MYFA_SERVERLESS_FETCH__ = true;
  window.__MYFA_NATIVE_FETCH__ = originalFetch;
})();
