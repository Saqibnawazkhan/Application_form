(function () {
  'use strict';

  var form = document.getElementById('loginForm');
  var button = document.getElementById('loginBtn');
  var alertBox = document.getElementById('loginAlert');
  var password = document.getElementById('password');

  function fail(message) {
    alertBox.textContent = message;
    alertBox.hidden = false;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (button.disabled) return;

    alertBox.hidden = true;
    if (!password.value) return fail('Please enter the admin password.');

    button.disabled = true;
    button.classList.add('is-submitting');

    fetch('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value })
    })
      .then(function (response) {
        return response.json().then(function (body) { return { status: response.status, body: body }; });
      })
      .then(function (result) {
        if (result.body && result.body.ok) {
          window.location.href = '/admin';
          return;
        }
        button.disabled = false;
        button.classList.remove('is-submitting');
        password.value = '';
        password.focus();
        fail((result.body && result.body.error) || 'Sign in failed.');
      })
      .catch(function () {
        button.disabled = false;
        button.classList.remove('is-submitting');
        fail('Network error. Please try again.');
      });
  });
})();
