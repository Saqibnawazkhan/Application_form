/* ===========================================================================
   Orbit Innovations — application form
   Vanilla JS, no dependencies. Client-side checks are for speed of feedback;
   the server re-validates everything.
   =========================================================================== */

(function () {
  'use strict';

  var MAX_FILE_BYTES = 5 * 1024 * 1024;
  var ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx'];

  var form = document.getElementById('applicationForm');
  if (!form) return;

  var $ = function (id) { return document.getElementById(id); };

  var submitBtn = $('submitBtn');
  var formAlert = $('formAlert');
  var successScreen = $('successScreen');
  var fileInput = $('cv');
  var dropzone = $('dropzone');
  var fileCard = $('fileCard');
  var progress = $('progress');
  var progressBar = $('progressBar');

  var isSubmitting = false;
  var hasSubmitted = false;
  var skills = [];

  /* ---------------------------------------------------------------- utils */

  function setError(field, message) {
    var input = $(field);
    var box = $(field + '-error');
    if (box) {
      box.textContent = message || '';
      box.classList.toggle('show', Boolean(message));
    }
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
    if (field === 'skills') $('chipsBox').classList.toggle('invalid', Boolean(message));
    if (field === 'cv') dropzone.classList.toggle('invalid', Boolean(message));
  }

  function clearErrors() {
    var boxes = form.querySelectorAll('.error');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].textContent = '';
      boxes[i].classList.remove('show');
    }
    var invalid = form.querySelectorAll('[aria-invalid="true"]');
    for (var j = 0; j < invalid.length; j++) invalid[j].removeAttribute('aria-invalid');
    $('chipsBox').classList.remove('invalid');
    dropzone.classList.remove('invalid');
    hideAlert();
  }

  function showAlert(message) {
    formAlert.textContent = message;
    formAlert.hidden = false;
  }

  function hideAlert() {
    formAlert.hidden = true;
    formAlert.textContent = '';
  }

  function value(id) {
    var el = $(id);
    return el ? el.value.trim() : '';
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* --------------------------------------------------------- field checks */

  var EMAIL_RE = /^[^\s@,;:<>()[\]\\"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
  var NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}.'\-\s]*$/u;

  function checkUrl(id, label) {
    var raw = value(id);
    if (!raw) return '';
    var candidate = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
    try {
      var url = new URL(candidate);
      if (!url.hostname || url.hostname.indexOf('.') === -1) throw new Error('bad host');
    } catch (error) {
      return 'Please enter a valid ' + label + ' URL.';
    }
    return '';
  }

  var validators = {
    fullName: function () {
      var name = value('fullName');
      if (!name) return 'Please enter your full name.';
      if (name.length < 2) return 'Name looks too short.';
      if (!NAME_RE.test(name)) return 'Please use letters only (no numbers or symbols).';
      return '';
    },
    email: function () {
      var email = value('email');
      if (!email) return 'Please enter your email address.';
      if (!EMAIL_RE.test(email)) return 'Please enter a valid email address.';
      return '';
    },
    phone: function () {
      var phone = value('phone');
      if (!phone) return 'Please enter your phone number.';
      if (!/^\+?[\d\s\-().]+$/.test(phone)) return 'Phone number can only contain digits, spaces and + - ( ).';
      var digits = phone.replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) return 'Please enter a valid phone number (8–15 digits).';
      return '';
    },
    city: function () {
      var city = value('city');
      if (!city) return 'Please enter your city.';
      if (city.length < 2) return 'City name looks too short.';
      return '';
    },
    position: function () {
      return value('position') ? '' : 'Please select the position you are applying for.';
    },
    workPreference: function () {
      return form.querySelector('input[name="workPreference"]:checked')
        ? '' : 'Please select your work preference.';
    },
    experience: function () {
      return value('experience') ? '' : 'Please select your years of experience.';
    },
    skills: function () {
      return skills.length ? '' : 'Please add at least one skill.';
    },
    portfolioUrl: function () { return checkUrl('portfolioUrl', 'portfolio or LinkedIn'); },
    githubUrl: function () { return checkUrl('githubUrl', 'GitHub'); },
    cv: function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return 'Please upload your CV or resume.';
      var extension = (file.name.split('.').pop() || '').toLowerCase();
      if (ALLOWED_EXTENSIONS.indexOf(extension) === -1) {
        return 'Please upload a PDF, DOC or DOCX file.';
      }
      if (file.size > MAX_FILE_BYTES) return 'Your CV is too large. Maximum size is 5 MB.';
      if (file.size === 0) return 'That file appears to be empty.';
      return '';
    },
    availabilityNote: function () {
      if (value('availability') !== 'Other') return '';
      return value('availabilityNote') ? '' : 'Please tell us when you can start.';
    },
    confirm: function () {
      return $('confirm').checked ? '' : 'Please confirm that your information is accurate.';
    }
  };

  var FIELD_ORDER = [
    'fullName', 'email', 'phone', 'city', 'position', 'workPreference', 'experience',
    'skills', 'portfolioUrl', 'githubUrl', 'cv', 'availabilityNote', 'confirm'
  ];

  function validateField(field) {
    var message = validators[field] ? validators[field]() : '';
    setError(field, message);
    return !message;
  }

  function validateAll() {
    var firstInvalid = null;
    for (var i = 0; i < FIELD_ORDER.length; i++) {
      var field = FIELD_ORDER[i];
      if (!validateField(field) && !firstInvalid) firstInvalid = field;
    }
    return firstInvalid;
  }

  function focusField(field) {
    var target = $(field);
    if (field === 'workPreference') target = form.querySelector('input[name="workPreference"]');
    if (field === 'skills') target = $('skillInput');
    if (!target) return;

    var anchor = target.closest ? target.closest('.field') || target : target;
    if (anchor.scrollIntoView) anchor.scrollIntoView({ block: 'center' });
    if (target.focus) target.focus({ preventScroll: true });
  }

  // Validate on blur, and clear an error as soon as the user fixes it.
  FIELD_ORDER.forEach(function (field) {
    var el = $(field);
    if (!el) return;
    el.addEventListener('blur', function () { validateField(field); });
    el.addEventListener('input', function () {
      if (el.getAttribute('aria-invalid') === 'true') validateField(field);
    });
  });

  var prefRadios = form.querySelectorAll('input[name="workPreference"]');
  for (var p = 0; p < prefRadios.length; p++) {
    prefRadios[p].addEventListener('change', function () { setError('workPreference', ''); });
  }
  $('confirm').addEventListener('change', function () { setError('confirm', ''); });
  $('position').addEventListener('change', function () {
    setError('position', '');
    renderSuggestions();
  });
  $('experience').addEventListener('change', function () { setError('experience', ''); });

  /* ------------------------------------------------------------- role cards */

  var rolePicks = document.querySelectorAll('.role-pick');
  for (var r = 0; r < rolePicks.length; r++) {
    rolePicks[r].addEventListener('click', function () {
      $('position').value = this.getAttribute('data-position');
      setError('position', '');
      renderSuggestions();
      document.getElementById('application-form').scrollIntoView({ block: 'start' });
      setTimeout(function () { $('fullName').focus({ preventScroll: true }); }, 350);
    });
  }

  /* ------------------------------------------------------------ skill chips */

  var SUGGESTIONS = {
    'Website Developer': ['HTML/CSS', 'JavaScript', 'React', 'Next.js', 'WordPress', 'Tailwind CSS', 'Node.js'],
    'App Developer': ['Flutter', 'React Native', 'Kotlin', 'Swift', 'Firebase', 'REST APIs', 'UI/UX'],
    'Digital Marketing Specialist': ['SEO', 'Meta Ads', 'Google Ads', 'Copywriting', 'Analytics', 'Content Strategy', 'Email Marketing'],
    'default': ['Communication', 'Git', 'Figma', 'Problem Solving', 'Teamwork']
  };

  var chipList = $('skillChips');
  var skillInput = $('skillInput');
  var chipsBox = $('chipsBox');
  var suggestionBox = $('skillSuggestions');

  function syncSkills() {
    $('skills').value = JSON.stringify(skills);
  }

  function renderChips() {
    chipList.textContent = '';
    skills.forEach(function (skill, index) {
      var li = document.createElement('li');
      li.className = 'chip';

      var text = document.createElement('span');
      text.className = 'chip-text';
      text.textContent = skill;

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Remove ' + skill);
      remove.textContent = '×';
      remove.addEventListener('click', function () {
        skills.splice(index, 1);
        renderChips();
        renderSuggestions();
        validateField('skills');
      });

      li.appendChild(text);
      li.appendChild(remove);
      chipList.appendChild(li);
    });
    syncSkills();
  }

  function addSkill(raw) {
    var skill = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!skill) return false;
    if (skills.length >= 20) {
      setError('skills', 'You can add up to 20 skills.');
      return false;
    }
    var exists = skills.some(function (item) { return item.toLowerCase() === skill.toLowerCase(); });
    if (exists) return false;

    skills.push(skill);
    renderChips();
    renderSuggestions();
    setError('skills', '');
    return true;
  }

  function renderSuggestions() {
    var list = SUGGESTIONS[$('position').value] || SUGGESTIONS.default;
    suggestionBox.textContent = '';
    list.forEach(function (skill) {
      var taken = skills.some(function (item) { return item.toLowerCase() === skill.toLowerCase(); });
      if (taken) return;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'suggestion';
      button.textContent = '+ ' + skill;
      button.addEventListener('click', function () {
        addSkill(skill);
        skillInput.focus();
      });
      suggestionBox.appendChild(button);
    });
  }

  skillInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      if (addSkill(skillInput.value)) skillInput.value = '';
    } else if (event.key === 'Backspace' && !skillInput.value && skills.length) {
      skills.pop();
      renderChips();
      renderSuggestions();
    }
  });

  skillInput.addEventListener('input', function () {
    // Support pasting or typing "react, node"
    if (skillInput.value.indexOf(',') !== -1) {
      var parts = skillInput.value.split(',');
      var tail = parts.pop();
      parts.forEach(addSkill);
      skillInput.value = tail.trim();
    }
  });

  skillInput.addEventListener('blur', function () {
    if (skillInput.value.trim()) {
      addSkill(skillInput.value);
      skillInput.value = '';
    }
    chipsBox.classList.remove('focused');
    validateField('skills');
  });

  skillInput.addEventListener('focus', function () { chipsBox.classList.add('focused'); });
  chipsBox.addEventListener('click', function (event) {
    if (event.target === chipsBox) skillInput.focus();
  });

  renderSuggestions();

  /* -------------------------------------------------------------- CV upload */

  function showFile(file) {
    $('fileName').textContent = file.name;
    $('fileSize').textContent = formatSize(file.size);
    fileCard.hidden = false;
    dropzone.hidden = true;
  }

  function resetFile() {
    fileInput.value = '';
    fileCard.hidden = true;
    dropzone.hidden = false;
    progress.hidden = true;
    progressBar.style.width = '0%';
  }

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) { resetFile(); return; }

    if (validateField('cv')) {
      showFile(file);
    } else {
      resetFile();
    }
  });

  $('fileRemove').addEventListener('click', function () {
    resetFile();
    setError('cv', '');
    fileInput.focus();
  });

  ['dragenter', 'dragover'].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (type) {
    dropzone.addEventListener(type, function (event) {
      event.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });
  dropzone.addEventListener('drop', function (event) {
    var files = event.dataTransfer && event.dataTransfer.files;
    if (!files || !files.length) return;
    if (typeof DataTransfer !== 'undefined') {
      var transfer = new DataTransfer();
      transfer.items.add(files[0]);
      fileInput.files = transfer.files;
      fileInput.dispatchEvent(new Event('change'));
    }
  });

  /* --------------------------------------------------- conditional + counter */

  $('availability').addEventListener('change', function () {
    var isOther = this.value === 'Other';
    $('availabilityNoteField').hidden = !isOther;
    if (!isOther) setError('availabilityNote', '');
  });

  var about = $('about');
  var aboutCount = $('about-count');
  about.addEventListener('input', function () {
    aboutCount.textContent = about.value.length + ' / 2000';
  });

  /* ------------------------------------------------------- submission state */

  function setSubmitting(state) {
    isSubmitting = state;
    submitBtn.disabled = state;
    submitBtn.classList.toggle('is-submitting', state);
    submitBtn.querySelector('.btn-label').textContent = state ? 'SUBMITTING…' : 'SUBMIT APPLICATION';
    progress.hidden = !state;
    if (!state) progressBar.style.width = '0%';
  }

  function showSuccess(applicationId) {
    hasSubmitted = true;
    $('referenceId').textContent = applicationId || '—';

    document.querySelector('.hero').hidden = true;
    document.querySelector('[aria-labelledby="roles-heading"]').hidden = true;
    document.getElementById('application-form').hidden = true;
    successScreen.hidden = false;

    window.scrollTo({ top: 0 });
    successScreen.focus({ preventScroll: true });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (isSubmitting || hasSubmitted) return;

    hideAlert();
    var firstInvalid = validateAll();
    if (firstInvalid) {
      showAlert('Please check the highlighted fields and try again.');
      focusField(firstInvalid);
      return;
    }

    var payload = new FormData();
    payload.append('fullName', value('fullName'));
    payload.append('email', value('email'));
    payload.append('phone', value('phone'));
    payload.append('city', value('city'));
    payload.append('position', value('position'));
    payload.append('workPreference', form.querySelector('input[name="workPreference"]:checked').value);
    payload.append('experience', value('experience'));
    payload.append('skills', JSON.stringify(skills));
    payload.append('portfolioUrl', value('portfolioUrl'));
    payload.append('githubUrl', value('githubUrl'));
    payload.append('about', about.value.trim());
    payload.append('expectedSalary', value('expectedSalary'));
    payload.append('availability', value('availability'));
    payload.append('availabilityNote', value('availabilityNote'));
    payload.append('confirm', $('confirm').checked ? 'true' : '');
    payload.append('website', value('website'));
    payload.append('startedAt', value('startedAt'));
    payload.append('source', value('source'));
    payload.append('cv', fileInput.files[0]);

    setSubmitting(true);

    var request = new XMLHttpRequest();
    request.open('POST', '/api/applications', true);
    request.setRequestHeader('Accept', 'application/json');
    request.timeout = 120000;

    request.upload.addEventListener('progress', function (event) {
      if (!event.lengthComputable) return;
      var percent = Math.round((event.loaded / event.total) * 100);
      progressBar.style.width = percent + '%';
      submitBtn.querySelector('.btn-label').textContent =
        percent < 100 ? 'UPLOADING ' + percent + '%' : 'SUBMITTING…';
    });

    request.addEventListener('load', function () {
      var body = {};
      try { body = JSON.parse(request.responseText || '{}'); } catch (error) { body = {}; }

      if (request.status >= 200 && request.status < 300 && body.ok) {
        progressBar.style.width = '100%';
        showSuccess(body.applicationId);
        setSubmitting(false);
        return;
      }

      setSubmitting(false);

      if (body.errors) {
        var firstServerError = null;
        Object.keys(body.errors).forEach(function (field) {
          setError(field, body.errors[field]);
          if (!firstServerError) firstServerError = field;
        });
        showAlert('Please check the highlighted fields and try again.');
        if (firstServerError) focusField(firstServerError);
        return;
      }

      showAlert(body.error || 'We could not submit your application. Please try again.');
      window.scrollTo({ top: formAlert.getBoundingClientRect().top + window.scrollY - 90 });
    });

    request.addEventListener('error', function () {
      setSubmitting(false);
      showAlert('Network error. Please check your connection and try again.');
    });

    request.addEventListener('timeout', function () {
      setSubmitting(false);
      showAlert('That took too long. Please check your connection and try again.');
    });

    request.send(payload);
  });

  /* ------------------------------------------------------------- share ---- */

  var shareStatus = $('shareStatus');

  function shareUrl() {
    return window.location.origin + window.location.pathname;
  }

  function flash(message) {
    shareStatus.textContent = message;
    setTimeout(function () { shareStatus.textContent = ''; }, 3000);
  }

  function copyLink() {
    var url = shareUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { flash('Link copied.'); },
        function () { flash(url); }
      );
      return;
    }
    var helper = document.createElement('input');
    helper.value = url;
    document.body.appendChild(helper);
    helper.select();
    try { document.execCommand('copy'); flash('Link copied.'); }
    catch (error) { flash(url); }
    document.body.removeChild(helper);
  }

  function share() {
    var data = {
      title: 'Orbit Innovations is hiring',
      text: 'Orbit Innovations is hiring Website Developers, App Developers and Digital Marketing Specialists. Hybrid — remote + onsite.',
      url: shareUrl()
    };
    if (navigator.share) {
      navigator.share(data).catch(function () { /* user dismissed the sheet */ });
    } else {
      copyLink();
    }
  }

  $('shareBtn').addEventListener('click', share);
  $('copyBtn').addEventListener('click', copyLink);
  $('successShare').addEventListener('click', share);

  if (!navigator.share) {
    $('shareBtn').textContent = 'Copy application link';
    $('copyBtn').hidden = true;
  }

  /* ------------------------------------------------------------ page setup */

  // Spam trap: how long the visitor spent on the form.
  $('startedAt').value = String(Date.now());

  // Where the candidate came from (Instagram bio link, etc.).
  (function detectSource() {
    var params = new URLSearchParams(window.location.search);
    var source = params.get('src') || params.get('utm_source') || '';
    if (!source && document.referrer) {
      try { source = new URL(document.referrer).hostname.replace(/^www\./, ''); }
      catch (error) { source = ''; }
    }
    $('source').value = source.slice(0, 60);
  })();

  // Preselect a position from ?role=app-developer
  (function preselectRole() {
    var role = (new URLSearchParams(window.location.search).get('role') || '').toLowerCase();
    if (!role) return;
    var options = $('position').options;
    for (var i = 1; i < options.length; i++) {
      if (options[i].text.toLowerCase().replace(/\s+/g, '-') === role) {
        $('position').selectedIndex = i;
        renderSuggestions();
        break;
      }
    }
  })();

  // Warn before losing a part-filled form.
  window.addEventListener('beforeunload', function (event) {
    if (hasSubmitted || isSubmitting) return;
    var touched = value('fullName') || value('email') || skills.length ||
                  (fileInput.files && fileInput.files.length);
    if (!touched) return;
    event.preventDefault();
    event.returnValue = '';
  });
})();
