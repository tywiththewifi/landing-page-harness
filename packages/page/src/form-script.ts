/**
 * The one script a published page runs. It checks the form in the browser, adds where
 * the lead came from (page, version, UTMs, HubSpot's tracking cookie) and posts JSON to
 * the form's action. A form with no action is a preview: it shows the thank-you message
 * and sends nothing. Plain ES2017 with no dependencies, so it ships inline.
 */
export const FORM_SCRIPT = `(function () {
  var UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  function cookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  function setError(form, name, message) {
    var input = form.elements[name];
    var slot = form.querySelector('[data-error-for="' + name + '"]');
    if (!input || !slot) return;
    slot.id = slot.id || "lph-error-" + name;
    slot.textContent = message;
    input.setAttribute("aria-invalid", message ? "true" : "false");
    if (message) input.setAttribute("aria-describedby", slot.id);
    else input.removeAttribute("aria-describedby");
  }
  function check(form) {
    var first = null;
    Array.prototype.forEach.call(form.querySelectorAll(".lph-input"), function (input) {
      var v = input.validity;
      var message = v.valid ? "" : v.valueMissing ? "This field is required." : input.type === "email" ? "Enter a valid email address." : "Check this field.";
      setError(form, input.name, message);
      if (message && !first) first = input;
    });
    if (first) first.focus();
    return !first;
  }
  Array.prototype.forEach.call(document.querySelectorAll("form[data-success]"), function (form) {
    form.noValidate = true;
    var status = form.querySelector(".lph-form__status");
    var button = form.querySelector("[type=submit]");
    function done(note) {
      var p = document.createElement("p");
      p.className = "lph-form__done";
      p.setAttribute("role", "status");
      p.setAttribute("tabindex", "-1");
      p.textContent = form.getAttribute("data-success") + (note || "");
      form.parentNode.replaceChild(p, form);
      p.focus();
    }
    function fail(message) {
      status.setAttribute("data-state", "error");
      status.textContent = message || "Sorry, that didn't go through. Please try again in a moment.";
      button.disabled = false;
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!check(form)) return;
      var fields = {};
      new FormData(form).forEach(function (value, key) { fields[key] = String(value); });
      var hp = fields._hp || "";
      delete fields._hp;
      var params = new URLSearchParams(location.search);
      var utm = {};
      UTM.forEach(function (k) { if (params.get(k)) utm[k] = params.get(k); });
      var body = {
        fields: fields,
        _hp: hp,
        context: { pageUri: location.href, pageName: document.title, variant: document.body.getAttribute("data-variant") || null, hutk: cookie("hubspotutk"), utm: utm, referrer: document.referrer }
      };
      var action = form.getAttribute("action");
      if (!action) return done(" (Preview: nothing was sent.)");
      button.disabled = true;
      status.removeAttribute("data-state");
      status.textContent = "Sending…";
      fetch(action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (res.ok) return done();
            if (data.errors) Object.keys(data.errors).forEach(function (name) { setError(form, name, data.errors[name]); });
            fail(data.message || data.error);
          });
        }, function () { fail("Couldn't reach the server. Check your connection and try again."); });
    });
  });
})();`;
