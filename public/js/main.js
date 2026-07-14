/* =============================================
   THE MAVRICKS EVENTS — GLOBAL JAVASCRIPT
   ============================================= */

async function getWeb3FormsAccessKey() {
  if (!window.WEB3FORMS_ACCESS_KEY) {
    throw new Error('WEB3FORMS_ACCESS_KEY is missing');
  }

  return window.WEB3FORMS_ACCESS_KEY;
}

window.getWeb3FormsAccessKey = getWeb3FormsAccessKey;

document.addEventListener('DOMContentLoaded', () => {

  /* ---- PRELOADER ---- */
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const isHomePage = currentPage === 'index.html';
  const web3FormsEndpoint = 'https://api.web3forms.com/submit';
  const homePreloaderStorageKey = 'mav-home-preloader-session-seen';
  const preloader = document.getElementById('mav-preloader');
  const preloaderDelay = parseInt(document.body?.dataset.preloaderDelay || '2200', 10);
  const hero = document.querySelector('.hero');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let hasSeenHomePreloader = false;

  /* ---- SMOOTH SCROLL (Lenis) ---- */
  /* Adds momentum / inertia scrolling for a "buttery" feel on desktop.
     Touch devices keep their native scroll (feels better and avoids input lag).
     Degrades gracefully to native scrolling if Lenis fails to load or the
     visitor prefers reduced motion. */
  let lenis = null;
  if (window.Lenis && !prefersReducedMotion) {
    lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 1,
    });

    const runLenis = (time) => {
      lenis.raf(time);
      window.requestAnimationFrame(runLenis);
    };
    window.requestAnimationFrame(runLenis);

    // Smooth in-page anchor jumps (links that start with "#").
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      const targetId = anchor.getAttribute('href');
      if (!targetId || targetId === '#') return;

      anchor.addEventListener('click', (event) => {
        const target = document.querySelector(targetId);
        if (!target) return;
        event.preventDefault();
        lenis.scrollTo(target, { offset: -80 });
      });
    });

    window.mavLenis = lenis;
  }

  try {
    hasSeenHomePreloader = window.sessionStorage.getItem(homePreloaderStorageKey) === 'true';
  } catch (error) {}

  const shouldShowPreloader = Boolean(preloader && isHomePage && !hasSeenHomePreloader);

  function getViewportHeight() {
    return Math.round(window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
  }

  function syncHeroViewportHeight(forceExpanded = false) {
    if (!hero) return;

    const viewportHeight = getViewportHeight();
    const introHeight = Math.max(320, Math.max(viewportHeight - 160, Math.round(viewportHeight * 0.78)));
    const currentHeight = forceExpanded || hero.classList.contains('hero-ready') || prefersReducedMotion
      ? viewportHeight
      : introHeight;

    hero.style.setProperty('--hero-viewport-height', `${viewportHeight}px`);
    hero.style.setProperty('--hero-current-height', `${currentHeight}px`);
  }

  function revealHeroViewport() {
    if (!hero) return;

    hero.classList.add('hero-ready');
    syncHeroViewportHeight(true);
    window.setTimeout(() => {
      hero.classList.remove('hero-opening');
    }, 1100);
  }

  if (hero) {
    if (prefersReducedMotion) {
      hero.classList.add('hero-ready');
      syncHeroViewportHeight(true);
    } else {
      hero.classList.add('hero-opening');
      syncHeroViewportHeight();
    }

    const handleHeroViewportChange = () => {
      syncHeroViewportHeight(hero.classList.contains('hero-ready') || prefersReducedMotion);
    };

    window.addEventListener('resize', handleHeroViewportChange);
    window.visualViewport?.addEventListener('resize', handleHeroViewportChange);
  }

  if (shouldShowPreloader) {
    document.body.classList.add('preloader-active');
    window.setTimeout(() => {
      preloader.classList.add('is-hidden');
      document.body.classList.remove('preloader-active');
      try {
        window.sessionStorage.setItem(homePreloaderStorageKey, 'true');
      } catch (error) {}
      revealHeroViewport();
    }, Number.isNaN(preloaderDelay) ? 2200 : preloaderDelay);
  } else if (preloader) {
    preloader.classList.add('is-hidden');

    if (hero && !prefersReducedMotion) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          revealHeroViewport();
        });
      });
    }
  } else if (hero && !prefersReducedMotion) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        revealHeroViewport();
      });
    });
  }

  function getPageLabel() {
    const pageLabels = {
      'index.html': 'Home Page',
      'about.html': 'About Page',
      'contact.html': 'Contact Page',
      'events.html': 'Events Page',
      'tickets.html': 'Tickets Page'
    };

    return pageLabels[currentPage] || currentPage.replace('.html', '').replace(/[-_]/g, ' ');
  }

  function upsertHiddenInput(form, name, value) {
    let input = form.querySelector(`input[name="${name}"]`);

    if (!input) {
      input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      form.prepend(input);
    }

    input.type = 'hidden';
    input.value = value;
    return input;
  }

  function ensureBotcheckField(form) {
    let field = form.querySelector('input[name="botcheck"]');

    if (!field) {
      field = document.createElement('input');
      field.name = 'botcheck';
      form.prepend(field);
    }

    field.type = 'checkbox';
    field.tabIndex = -1;
    field.autocomplete = 'off';
    field.style.display = 'none';
    field.checked = false;
    return field;
  }

  async function submitWeb3Form(form, options = {}) {
    const submitButton = options.submitButton || form.querySelector('button[type="submit"]');
    const originalButtonHtml = submitButton ? submitButton.innerHTML : '';
    const originalButtonText = submitButton ? submitButton.textContent : '';
    const emailField = form.querySelector('input[name="email"]');
    const emailValue = emailField?.value.trim() || '';

    if (emailValue) {
      upsertHiddenInput(form, 'replyto', emailValue);
    }

    form.setAttribute('action', web3FormsEndpoint);
    form.setAttribute('method', 'POST');

    if (submitButton) {
      submitButton.disabled = true;
      if (options.loadingHtml) {
        submitButton.innerHTML = options.loadingHtml;
      } else if (options.loadingText) {
        submitButton.textContent = options.loadingText;
      }
    }

    try {
      const accessKey = await getWeb3FormsAccessKey();
      const formData = new FormData(form);
      formData.set('access_key', accessKey);

      if (emailValue) {
        formData.set('replyto', emailValue);
      }

      const response = await fetch(web3FormsEndpoint, {
        method: 'POST',
        body: formData
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Form submission failed');
      }

      options.onSuccess?.(result, {
        submitButton,
        originalButtonHtml,
        originalButtonText
      });

      return result;
    } catch (error) {
      console.error('Web3Forms submission failed:', error);
      options.onError?.(error, {
        submitButton,
        originalButtonHtml,
        originalButtonText
      });
      throw error;
    } finally {
      if (submitButton) {
        window.setTimeout(() => {
          submitButton.disabled = false;
          submitButton.innerHTML = originalButtonHtml;
        }, options.resetDelayMs ?? 0);
      }
    }
  }

  /* ---- GOOGLE SHEETS LOGGING ---- */
  /* Best-effort copy of every form submission to a Google Apps Script web app,
     which appends it to a Google Sheet (one tab per form type). Runs in parallel
     with Web3Forms and never blocks the user: Apps Script can't send CORS headers,
     so we fire a no-cors request and ignore the (opaque) response. The row is still
     written server-side. Configure the endpoint in js/form-config.js. */
  function sendToGoogleSheet(form) {
    const endpoint = window.MAVRICKS_SHEET_ENDPOINT || '';
    if (!endpoint || !form) return;

    try {
      const formData = new FormData(form);
      formData.delete('access_key'); // never forward the Web3Forms key to the sheet
      formData.set('page', getPageLabel());
      formData.set('submitted_at', new Date().toISOString());

      const secret = window.MAVRICKS_SHEET_SECRET || '';
      if (secret) formData.set('_secret', secret);

      window.fetch(endpoint, {
        method: 'POST',
        mode: 'no-cors',
        body: formData
      }).catch(() => {});
    } catch (error) {
      // Logging is best-effort; never surface this to the user.
    }
  }

  /* ---- HERO TYPED TEXT ---- */
  const heroTyped = document.querySelector('.hero-typed');

  function initHeroTypedText() {
    if (!heroTyped || heroTyped.dataset.typedReady === 'true') return;

    const words = (heroTyped.dataset.typedWords || '')
      .split('|')
      .map(word => word.trim())
      .filter(Boolean);

    if (!words.length) return;

    const longestWordLength = words.reduce((maxLength, word) => Math.max(maxLength, word.length), 0);
    heroTyped.style.setProperty('--hero-typed-width', `${Math.max(longestWordLength, 8)}ch`);
    heroTyped.dataset.typedReady = 'true';

    if (prefersReducedMotion || words.length === 1) {
      heroTyped.textContent = words[0];
      return;
    }

    let wordIndex = 0;
    let charIndex = 0;
    let isDeleting = false;

    const typeSpeed = 95;
    const deleteSpeed = 55;
    const holdDelay = 1300;
    const nextWordDelay = 220;

    const tick = () => {
      const currentWord = words[wordIndex];

      if (isDeleting) {
        charIndex = Math.max(0, charIndex - 1);
      } else {
        charIndex = Math.min(currentWord.length, charIndex + 1);
      }

      heroTyped.textContent = currentWord.slice(0, charIndex);

      let delay = isDeleting ? deleteSpeed : typeSpeed;

      if (!isDeleting && charIndex === currentWord.length) {
        isDeleting = true;
        delay = holdDelay;
      } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        wordIndex = (wordIndex + 1) % words.length;
        delay = nextWordDelay;
      }

      window.setTimeout(tick, delay);
    };

    heroTyped.textContent = '';
    window.setTimeout(tick, 320);
  }

  if (heroTyped) {
    const typedStartDelay = preloader && !prefersReducedMotion
      ? (Number.isNaN(preloaderDelay) ? 2200 : preloaderDelay) + 350
      : 350;

    window.setTimeout(initHeroTypedText, typedStartDelay);
  }

  /* ---- TEXT TRANSITIONS ---- */
  const textTransitionTargets = document.querySelectorAll('.section-label, .section-title, .section-desc');

  function wrapTextNode(node, wordCounter) {
    const text = node.textContent;
    if (!text || !text.trim()) return wordCounter;

    const fragment = document.createDocumentFragment();
    const parts = text.split(/(\s+)/);

    parts.forEach((part) => {
      if (!part) return;
      if (/^\s+$/.test(part)) {
        const space = document.createElement('span');
        space.className = 'tt-space';
        space.textContent = part;
        fragment.appendChild(space);
        return;
      }

      const word = document.createElement('span');
      word.className = 'tt-word';
      word.style.setProperty('--word-index', wordCounter);
      word.textContent = part;
      fragment.appendChild(word);
      wordCounter += 1;
    });

    node.parentNode.replaceChild(fragment, node);
    return wordCounter;
  }

  function decorateTextTransition(element) {
    if (element.dataset.textTransitionReady === 'true') return;

    let wordCounter = 0;

    function processNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        wordCounter = wrapTextNode(node, wordCounter);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;

      Array.from(node.childNodes).forEach(processNode);
    }

    processNode(element);
    element.classList.add('text-transition');
    element.dataset.textTransitionReady = 'true';
  }

  textTransitionTargets.forEach(decorateTextTransition);

  /* ---- CUSTOM CURSOR ---- */
  const cursor = document.querySelector('.cursor');
  const follower = document.querySelector('.cursor-follower');
  const shouldDisableCustomCursor = window.matchMedia('(max-width: 768px), (hover: none)').matches;

  if (cursor && follower && !shouldDisableCustomCursor) {
    let mouseX = 0, mouseY = 0, followerX = 0, followerY = 0;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      cursor.style.left = mouseX + 'px';
      cursor.style.top = mouseY + 'px';
    });

    function animateFollower() {
      followerX += (mouseX - followerX) * 0.12;
      followerY += (mouseY - followerY) * 0.12;
      follower.style.left = followerX + 'px';
      follower.style.top = followerY + 'px';
      requestAnimationFrame(animateFollower);
    }
    animateFollower();

    document.querySelectorAll('a, button, .card, .nav-cta').forEach(el => {
      el.addEventListener('mouseenter', () => {
        cursor.classList.add('hover');
        follower.classList.add('hover');
      });
      el.addEventListener('mouseleave', () => {
        cursor.classList.remove('hover');
        follower.classList.remove('hover');
      });
    });
  }

  /* ---- NAVBAR SCROLL ---- */
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 60) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    });
  }

  /* ---- HAMBURGER MENU ---- */
  const hamburger = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    const setMenuState = (isOpen) => {
      hamburger.classList.toggle('open', isOpen);
      navLinks.classList.toggle('open', isOpen);
      document.body.classList.toggle('nav-open', isOpen);
      navbar?.classList.toggle('menu-open', isOpen);
      hamburger.setAttribute('aria-expanded', String(isOpen));
      // Lock/unlock momentum scroll so the background doesn't drift while the menu is open.
      if (lenis) {
        if (isOpen) lenis.stop();
        else lenis.start();
      }
    };

    hamburger.addEventListener('click', () => {
      const isOpen = !navLinks.classList.contains('open');
      setMenuState(isOpen);
    });

    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        setMenuState(false);
      });
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) {
        setMenuState(false);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setMenuState(false);
      }
    });
  }

  /* ---- ACTIVE NAV LINK ---- */
  document.querySelectorAll('.nav-links a').forEach(link => {
    const linkPage = link.getAttribute('href');
    if (linkPage === currentPage) {
      link.classList.add('active');
    }
  });

  /* ---- SCROLL REVEAL ---- */
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    reveals.forEach(el => observer.observe(el));
  }

  /* ---- TICKER CLONE (for seamless loop) ---- */
  const track = document.querySelector('.ticker-track');
  if (track) {
    track.innerHTML += track.innerHTML;
  }

  /* ---- COUNTER ANIMATION ---- */
  function animateCounter(el) {
    const target = parseInt(el.getAttribute('data-target'));
    const duration = 2000;
    const step = target / (duration / 16);
    let current = 0;
    const timer = setInterval(() => {
      current += step;
      if (current >= target) {
        current = target;
        clearInterval(timer);
      }
      el.textContent = Math.floor(current).toLocaleString();
    }, 16);
  }

  const counters = document.querySelectorAll('[data-target]');
  if (counters.length) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(c => counterObserver.observe(c));
  }

  /* ---- CONTACT CTAs -> DEEP-LINK TO THE FORM ---- */
  /* Make in-content links to the contact page open it AND scroll to the form
     (e.g. "Get Notified", "Get Updates", "Plan Now"). Navbar/footer "Contact"
     links are left pointing at the top of the page. */
  document.querySelectorAll('a[href="contact.html"]').forEach((link) => {
    if (link.closest('.nav-links') || link.closest('.footer')) return;
    link.setAttribute('href', 'contact.html#contact-form');
  });

  /* When a page loads with a hash (e.g. contact.html#contact-form), smooth-scroll
     to that target, accounting for the fixed navbar. */
  function scrollToHashTarget() {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;

    let target = null;
    try {
      target = document.querySelector(hash);
    } catch (error) {
      return;
    }
    if (!target) return;

    const navOffset = 96;
    if (lenis) {
      lenis.scrollTo(target, { offset: -navOffset });
    } else {
      const top = target.getBoundingClientRect().top + (window.pageYOffset || 0) - navOffset;
      window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    }
  }

  if (window.location.hash) {
    // Defer so layout settles (and Lenis is running) before scrolling.
    window.setTimeout(scrollToHashTarget, 400);
  }

  /* ---- SMOOTH LINK TRANSITIONS ---- */
  const transition = document.querySelector('.page-transition');
  if (transition) {
    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('http') && !href.startsWith('mailto')) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          transition.classList.add('active');
          setTimeout(() => {
            window.location.href = href;
          }, 450);
        });
      }
    });
    window.addEventListener('pageshow', () => {
      transition.classList.remove('active');
    });
  }

  /* ---- SCROLL STORY ---- */
  const storyPanels = Array.from(document.querySelectorAll('section, .promo-banner, .ticker-wrap, .trust-section, .faq-section, .newsletter-section, .private-cta'))
    .filter((panel, index, array) => panel.querySelector('.container') && array.indexOf(panel) === index);

  if (storyPanels.length) {
    storyPanels.forEach((panel, index) => {
      panel.classList.add('story-panel');
      panel.dataset.storyIndex = index;
    });

    const storyProgress = document.createElement('div');
    storyProgress.className = 'story-progress';
    storyProgress.innerHTML = `
      <div class="story-progress__line"></div>
      <div class="story-progress__dots">
        ${storyPanels.map(() => '<span class="story-progress__dot"></span>').join('')}
      </div>
    `;
    document.body.appendChild(storyProgress);

    const storyDots = Array.from(storyProgress.querySelectorAll('.story-progress__dot'));

    let storyTicking = false;

    function updateStoryState() {
      const viewportHeight = window.innerHeight || 1;
      const pageHeight = Math.max(document.documentElement.scrollHeight - viewportHeight, 1);
      const overallProgress = Math.min(Math.max(window.scrollY / pageHeight, 0), 1);
      document.documentElement.style.setProperty('--story-overall-progress', overallProgress.toFixed(3));

      let activeIndex = 0;

      storyPanels.forEach((panel, index) => {
        const rect = panel.getBoundingClientRect();
        const panelMid = rect.top + (rect.height * 0.5);
        const distance = Math.abs((viewportHeight * 0.5) - panelMid);
        const normalized = Math.max(0, 1 - (distance / (viewportHeight * 0.85)));
        panel.style.setProperty('--story-progress', normalized.toFixed(3));

        const isPast = rect.top < viewportHeight * 0.18;
        const isActive = rect.top < viewportHeight * 0.58 && rect.bottom > viewportHeight * 0.34;

        panel.classList.toggle('story-panel-past', isPast && !isActive);
        panel.classList.toggle('story-panel-active', isActive);

        if (isActive) {
          activeIndex = index;
        }
      });

      storyDots.forEach((dot, index) => {
        dot.classList.toggle('is-active', index === activeIndex);
      });

      storyTicking = false;
    }

    function requestStoryUpdate() {
      if (storyTicking) return;
      storyTicking = true;
      window.requestAnimationFrame(updateStoryState);
    }

    updateStoryState();
    window.addEventListener('scroll', requestStoryUpdate, { passive: true });
    window.addEventListener('resize', requestStoryUpdate);
  }

  /* ---- LEGACY NEWSLETTER FORM ---- */
  document.querySelectorAll('.newsletter-form-disabled-never-match').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      const input = form.querySelector('input[name="email"]');
      const originalText = btn ? btn.textContent : '';

      if (!btn || !input || !input.value) return;

      btn.disabled = true;
      btn.textContent = 'Submitting...';

      try {
        const accessKey = await getWeb3FormsAccessKey();
        const formData = new FormData(form);
        formData.set('access_key', accessKey);
        const response = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          body: formData
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Newsletter signup failed');
        }

        btn.textContent = 'Subscribed! 🎉';
        btn.style.background = 'linear-gradient(135deg, #00f0ff, #7b2fff)';
        form.reset();
      } catch (error) {
        btn.textContent = 'Try Again';
      } finally {
        setTimeout(() => {
          btn.textContent = originalText;
          btn.style.background = '';
          btn.disabled = false;
        }, 3000);
      }
    });
  });

  /* ---- TAB SYSTEM ---- */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.tabs');
      if (!group) return;
      group.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.getAttribute('data-tab');
      group.closest('section').querySelectorAll('.tab-panel').forEach(p => {
        p.classList.toggle('active', p.getAttribute('data-panel') === target);
      });
    });
  });

  /* ---- ACCORDION ---- */
  document.querySelectorAll('.accordion-item').forEach(item => {
    const header = item.querySelector('.accordion-header');
    const body = item.querySelector('.accordion-body');
    if (header && body) {
      header.addEventListener('click', () => {
        const isOpen = item.classList.contains('open');
        document.querySelectorAll('.accordion-item.open').forEach(i => {
          i.classList.remove('open');
          i.querySelector('.accordion-body').style.maxHeight = null;
        });
        if (!isOpen) {
          item.classList.add('open');
          body.style.maxHeight = body.scrollHeight + 'px';
        }
      });
    }
  });

  /* ---- LIGHTBOX / MODAL ---- */
  document.querySelectorAll('[data-modal]').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const id = trigger.getAttribute('data-modal');
      const modal = document.getElementById(id);
      if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
      }
    });
  });
  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', () => {
      el.closest('.modal').classList.remove('open');
      document.body.style.overflow = '';
    });
  });

  /* ---- PARALLAX HERO ---- */
  const heroVisual = document.querySelector('.hero-parallax');
  if (heroVisual && !prefersReducedMotion) {
    let parallaxTicking = false;

    const applyParallax = () => {
      const scrollY = window.scrollY || window.pageYOffset || 0;
      // translate3d keeps the layer on the GPU for smoother compositing.
      heroVisual.style.transform = `translate3d(0, ${(scrollY * 0.35).toFixed(2)}px, 0)`;
      parallaxTicking = false;
    };

    const requestParallax = () => {
      if (parallaxTicking) return;
      parallaxTicking = true;
      window.requestAnimationFrame(applyParallax);
    };

    // Drive parallax off Lenis when available so it stays perfectly in sync;
    // otherwise fall back to a rAF-throttled native scroll listener.
    if (lenis) {
      lenis.on('scroll', requestParallax);
    } else {
      window.addEventListener('scroll', requestParallax, { passive: true });
    }
  }

  /* ---- FILTER BUTTONS ---- */
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.filter-group');
      group.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.getAttribute('data-filter');
      document.querySelectorAll('.filterable').forEach(item => {
        if (filter === 'all' || item.getAttribute('data-category') === filter) {
          item.style.display = '';
          item.style.animation = 'scaleIn 0.4s ease forwards';
        } else {
          item.style.display = 'none';
        }
      });
    });
  });

  /* ---- TICKET QUANTITY ---- */
  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('.qty-input');
      if (!input) return;
      let val = parseInt(input.value) || 1;
      if (btn.classList.contains('minus')) { val = Math.max(1, val - 1); }
      else { val = Math.min(20, val + 1); }
      input.value = val;
      updateTicketPrice(btn.closest('.ticket-row'));
    });
  });

  function updateTicketPrice(row) {
    if (!row) return;
    const qty = parseInt(row.querySelector('.qty-input')?.value) || 0;
    const price = parseFloat(row.getAttribute('data-price')) || 0;
    const total = row.querySelector('.ticket-total');
    if (total) total.textContent = '₹' + (qty * price).toLocaleString();
  }

  const paymentForm = document.getElementById('payment-form');
  const receiptSummary = document.getElementById('receipt-summary');
  const successModal = document.getElementById('success-modal');
  const paymentApiBase = String(
    window.MAVRICKS_PAYMENT_API_BASE || 
    document.querySelector('meta[name="payment-api-base"]')?.content || 
    '/api'
  ).replace(/\/$/, '');

  function openReceiptModal(receipt) {
    if (!successModal || !receiptSummary) return;
    const lines = [
      `<div class="receipt-row"><span>Date</span><strong>${receipt.date || 'Pending'}</strong></div>`,
      `<div class="receipt-row"><span>Status</span><strong>${receipt.status || 'Pending'}</strong></div>`,
      `<div class="receipt-row"><span>Amount</span><strong>${receipt.amount || '₹0'}</strong></div>`,
      `<div class="receipt-row"><span>Transaction ID</span><strong>${receipt.transactionId || 'Pending'}</strong></div>`,
    ];
    receiptSummary.innerHTML = lines.join('');
    receiptSummary.style.display = 'block';
    successModal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  if (paymentForm) {
    paymentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submitButton = paymentForm.querySelector('button[type="submit"]');
      const originalText = submitButton ? submitButton.textContent : '';
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Preparing payment...';
      }

      const formData = new FormData(paymentForm);
      const payload = {
        eventKey: paymentForm.dataset.eventKey || formData.get('eventKey') || 'march-madness',
        packageType: formData.get('packageType') || 'stag',
        quantity: Number(formData.get('quantity') || 1),
        tableType: formData.get('tableType') || '',
        addOns: formData.getAll('addOns').filter(Boolean),
        customerEmail: formData.get('customerEmail') || '',
        customerPhone: formData.get('customerPhone') || '',
      };

      try {
        const token = localStorage.getItem('firebaseIdToken') || '';
        const response = await fetch(`${paymentApiBase}/create-payment-session`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok || !result.ok) {
          throw new Error(result.error || 'Payment could not be started');
        }

        if (result.paymentUrl) {
          window.location.href = result.paymentUrl;
          return;
        }

        openReceiptModal({
          date: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
          status: 'Pending',
          amount: `₹${Number(result.amount || 0).toLocaleString('en-IN')}`,
          transactionId: result.paymentRef || 'Pending',
        });
      } catch (error) {
        console.error(error);
        alert(error.message || 'Unable to start payment.');
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = originalText;
        }
      }
    });
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('status') === 'success' && params.get('booking')) {
    openReceiptModal({
      date: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
      status: 'Paid',
      amount: '₹0',
      transactionId: params.get('booking') || 'Pending',
    });
  }

  /* ---- GALLERY LIGHTBOX ---- */
  document.querySelectorAll('.gallery-item img').forEach(img => {
    img.addEventListener('click', () => {
      let lb = document.querySelector('.img-lightbox');
      if (!lb) {
        lb = document.createElement('div');
        lb.className = 'img-lightbox';
        lb.innerHTML = `<div class="lb-overlay"></div><div class="lb-content"><img/><button class="lb-close">✕</button></div>`;
        lb.style.cssText = 'position:fixed;inset:0;z-index:99996;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.3s ease';
        lb.querySelector('.lb-overlay').style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.92);cursor:pointer';
        lb.querySelector('.lb-content').style.cssText = 'position:relative;max-width:90vw;max-height:90vh;z-index:1';
        lb.querySelector('.lb-content img').style.cssText = 'max-width:100%;max-height:90vh;object-fit:contain;border-radius:12px';
        lb.querySelector('.lb-close').style.cssText = 'position:absolute;top:-16px;right:-16px;width:36px;height:36px;border-radius:50%;background:var(--neon);color:white;font-size:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:none';
        document.body.appendChild(lb);
        lb.querySelector('.lb-overlay').onclick = () => lb.remove();
        lb.querySelector('.lb-close').onclick = () => lb.remove();
      }
      lb.querySelector('img').src = img.src;
    });
  });

  /* ---- SHARED CONTACT FORM TABS ---- */
  document.querySelectorAll('.form-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const formWrap = tab.closest('.contact-form-wrap');
      const target = tab.dataset.tab;

      if (!formWrap || !target) return;

      formWrap.querySelectorAll('.form-tab').forEach(item => item.classList.remove('active'));
      tab.classList.add('active');

      formWrap.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.panel === target);
      });
    });
  });

  /* ---- SHARED CONTACT FORM SUBMISSION ---- */
  document.querySelectorAll('.contact-form').forEach(form => {
    form.setAttribute('action', web3FormsEndpoint);
    form.setAttribute('method', 'POST');
    ensureBotcheckField(form);
    upsertHiddenInput(form, 'replyto', form.querySelector('input[name="replyto"]')?.value || '');
    upsertHiddenInput(form, 'submission_source', `${getPageLabel()} - ${form.dataset.panel || 'form'}`);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const toast = document.getElementById('form-toast');
      const submitButton = form.querySelector('button[type="submit"]');

      // Fire-and-forget copy to Google Sheets (independent of Web3Forms).
      sendToGoogleSheet(form);

      try {
        await submitWeb3Form(form, {
          submitButton,
          loadingText: 'Sending...',
          onSuccess: () => {
            if (toast) {
              toast.textContent = "Message sent! We'll get back to you within 24 hours.";
              toast.classList.add('show');
              window.setTimeout(() => toast.classList.remove('show'), 4000);
            }
            form.reset();
          },
          onError: () => {
            if (toast) {
              toast.textContent = 'Unable to send message right now. Please try again.';
              toast.classList.add('show');
              window.setTimeout(() => toast.classList.remove('show'), 4000);
            }
          }
        });
      } catch (error) {
        // Handled in submitWeb3Form callbacks.
      }
    });
  });

  /* ---- SHARED NEWSLETTER FORM SUBMISSION ---- */
  document.querySelectorAll('.newsletter-form, .footer-newsletter form').forEach(form => {
    const isFooterNewsletter = form.closest('.footer-newsletter') !== null;
    const submitButton = form.querySelector('button[type="submit"]');
    const subject = form.querySelector('input[name="subject"]')?.value || 'New Newsletter Signup - Mavricks Events';
    const fromName = form.querySelector('input[name="from_name"]')?.value || 'Mavricks Events Website';
    const signupSource = `${isFooterNewsletter ? 'Footer Newsletter' : 'Newsletter Section'} - ${getPageLabel()}`;

    form.setAttribute('action', web3FormsEndpoint);
    form.setAttribute('method', 'POST');
    ensureBotcheckField(form);
    upsertHiddenInput(form, 'subject', subject);
    upsertHiddenInput(form, 'from_name', fromName);
    upsertHiddenInput(form, 'form_type', 'Newsletter');
    upsertHiddenInput(form, 'signup_source', signupSource);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!submitButton) return;

      // Fire-and-forget copy to Google Sheets (independent of Web3Forms).
      sendToGoogleSheet(form);

      try {
        await submitWeb3Form(form, {
          submitButton,
          loadingText: 'Submitting...',
          resetDelayMs: 3000,
          onSuccess: () => {
            submitButton.textContent = 'Subscribed!';
            submitButton.style.background = 'linear-gradient(135deg, #00f0ff, #7b2fff)';
            form.reset();
          },
          onError: () => {
            submitButton.textContent = 'Try Again';
          }
        });
      } catch (error) {
        // Handled in submitWeb3Form callbacks.
      } finally {
        window.setTimeout(() => {
          submitButton.style.background = '';
        }, 3000);
      }
    });
  });

  // Firebase initialization and Auth gating
  (async function initFirebaseAuthentication() {
    const loginModal = document.getElementById('loginModal');
    const userProfileWidget = document.getElementById('userProfileWidget');
    const userProfileName = document.getElementById('userProfileName');
    const logoutBtn = document.getElementById('logoutBtn');
    const submitPaymentBtn = document.getElementById('submitPaymentBtn');
    const navLoginBtn = document.getElementById('navLoginBtn');

    let auth = null;

    // Define modal open/close functions immediately so they exist no matter what
    function openModal() {
      if (loginModal) loginModal.style.display = 'flex';
    }
    function closeModal() {
      if (loginModal) loginModal.style.display = 'none';
    }

    if (loginModal) {
      const closeModalBtn = document.getElementById('closeModalBtn');
      if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
      loginModal.addEventListener('click', (e) => {
        if (e.target === loginModal) closeModal();
      });
      window.openLoginModal = openModal;
      window.closeLoginModal = closeModal;
    }

    // Register Nav Login/Logout Button Handler immediately so e.preventDefault() always blocks page jump
    if (navLoginBtn) {
      navLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (loginModal) {
          openModal();
        } else {
          window.location.href = 'tickets.html?login=true';
        }
      });
    }

    // 1. Fetch Firebase config from backend
    let firebaseConfig;
    try {
      const configRes = await fetch(`${paymentApiBase}/firebase-config`);
      firebaseConfig = await configRes.json();
    } catch (err) {
      console.error('Failed to load Firebase configuration:', err);
      return; // Exit here but listeners are already bound!
    }

    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();

    let idToken = null;
    let currentUser = null;
    let confirmationResult = null;

    if (loginModal) {
      // Recaptcha verifier for Phone OTP
      window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
        'size': 'invisible',
        'callback': (response) => {
          // reCAPTCHA solved
        }
      });

      // Tab switching logic
      const tabButtons = loginModal.querySelectorAll('.tab-btn');
      const tabContents = loginModal.querySelectorAll('.tab-content');

      tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          tabButtons.forEach(b => b.classList.remove('active'));
          tabContents.forEach(c => c.classList.remove('active'));

          btn.classList.add('active');
          const tabId = btn.dataset.tab;
          loginModal.querySelector(`#${tabId}`).classList.add('active');
        });
      });
    }

    // 3. Update UI on Auth State Change
    auth.onAuthStateChanged(async (user) => {
      currentUser = user;
      
      const loggedOutPanels = document.querySelectorAll('.auth-logged-out');
      const loggedInPanels = document.querySelectorAll('.auth-logged-in');
      const authTabsHeader = document.getElementById('authTabsHeader');
      const profileView = document.getElementById('profileView');
      
      if (user) {
        idToken = await user.getIdToken();
        localStorage.setItem('firebaseIdToken', idToken);

        // Auto-fill form fields
        const emailInput = document.getElementById('customerEmail');
        const phoneInput = document.getElementById('customerPhone');

        if (emailInput && user.email) {
          emailInput.value = user.email;
          emailInput.readOnly = true;
        }
        if (phoneInput && user.phoneNumber) {
          phoneInput.value = user.phoneNumber;
          phoneInput.readOnly = true;
        }

        if (userProfileName) {
          userProfileName.textContent = user.displayName || user.email || user.phoneNumber || 'User';
        }
        if (userProfileWidget) {
          userProfileWidget.style.display = 'flex';
        }
        
        // Hide auth headers and tabs, show profileView
        if (authTabsHeader) authTabsHeader.style.display = 'none';
        loggedOutPanels.forEach(el => el.style.display = 'none');
        loggedInPanels.forEach(el => el.style.display = 'block');
        if (profileView) profileView.style.display = 'block';

        // Render circular initials profile badge in the navbar
        if (navLoginBtn) {
          let initial = 'U';
          if (user.displayName) {
            initial = user.displayName.trim().charAt(0);
          } else if (user.email) {
            initial = user.email.trim().charAt(0);
          } else if (user.phoneNumber) {
            initial = user.phoneNumber.replace('+', '').charAt(0);
          }
          navLoginBtn.classList.add('nav-avatar-btn');
          navLoginBtn.innerHTML = `<div class="nav-avatar-circle">${initial}</div>`;
        }

        // Prefill profile edit inputs
        const profileNameInput = document.getElementById('profileName');
        const profileEmailInput = document.getElementById('profileEmail');
        const profileDobInput = document.getElementById('profileDob');
        const profileCityInput = document.getElementById('profileCity');

        if (profileNameInput) profileNameInput.value = user.displayName || '';
        if (profileEmailInput) profileEmailInput.value = user.email || '';

        // Fetch remaining details from Neon DB
        try {
          const profileRes = await fetch(`${paymentApiBase}/profile`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
          });
          const profileData = await profileRes.json();
          if (profileData.ok && profileData.profile) {
            const prof = profileData.profile;
            if (profileNameInput && prof.name) profileNameInput.value = prof.name;
            if (profileEmailInput && prof.email) profileEmailInput.value = prof.email;
            if (profileDobInput && prof.date_of_birth) {
              profileDobInput.value = prof.date_of_birth.split('T')[0];
            }
            if (profileCityInput && prof.city) profileCityInput.value = prof.city;
          }
        } catch (err) {
          console.error('Failed to retrieve user profile metadata from database:', err);
        }

        // Email Verification Banner Status
        const verificationBanner = document.getElementById('verificationBanner');
        const verificationStatusText = document.getElementById('verificationStatusText');
        const sendVerifyEmailBtn = document.getElementById('sendVerifyEmailBtn');

        if (verificationBanner) {
          if (user.email && !user.emailVerified) {
            verificationBanner.style.display = 'flex';
            if (verificationStatusText) verificationStatusText.textContent = 'Email Not Verified';
            if (sendVerifyEmailBtn) {
              sendVerifyEmailBtn.style.display = 'inline-block';
              sendVerifyEmailBtn.onclick = async () => {
                try {
                  await user.sendEmailVerification();
                  alert('Verification email has been sent! Please check your inbox.');
                } catch (verifyErr) {
                  console.error('Verification email error:', verifyErr);
                  alert(verifyErr.message);
                }
              };
            }
          } else {
            verificationBanner.style.display = 'none';
          }
        }

        // Hook up profile updates
        const profileEditForm = document.getElementById('profileEditForm');
        if (profileEditForm) {
          profileEditForm.onsubmit = async (e) => {
            e.preventDefault();
            const editName = profileNameInput.value.trim();
            const editEmail = profileEmailInput.value.trim();
            const editDob = profileDobInput ? profileDobInput.value : '';
            const editCity = profileCityInput ? profileCityInput.value.trim() : '';

            try {
              // 1. Update backend Neon Database
              const updateRes = await fetch(`${paymentApiBase}/profile`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ name: editName, email: editEmail, date_of_birth: editDob, city: editCity })
              });
              const updateData = await updateRes.json();
              if (!updateData.ok) throw new Error(updateData.error || 'Update failed');

              // 2. Update Firebase display profile
              await user.updateProfile({ displayName: editName });
              alert('Profile updated successfully!');
              
              // Refresh initials badge
              if (navLoginBtn) {
                const newInitial = editName ? editName.charAt(0) : 'U';
                navLoginBtn.innerHTML = `<div class="nav-avatar-circle">${newInitial}</div>`;
              }
            } catch (updateErr) {
              console.error('Failed to save profile changes:', updateErr);
              alert(updateErr.message);
            }
          };
        }

        // Hook up password changes
        const profilePasswordForm = document.getElementById('profilePasswordForm');
        if (profilePasswordForm) {
          profilePasswordForm.onsubmit = async (e) => {
            e.preventDefault();
            const newPass = document.getElementById('profileNewPassword').value;
            const confirmPass = document.getElementById('profileConfirmPassword').value;

            if (newPass !== confirmPass) {
              alert('Passwords do not match.');
              return;
            }

            try {
              await user.updatePassword(newPass);
              alert('Password updated successfully!');
              document.getElementById('profileNewPassword').value = '';
              document.getElementById('profileConfirmPassword').value = '';
            } catch (passErr) {
              console.error('Failed to change password:', passErr);
              alert(passErr.message);
            }
          };
        }

        // Hook up profile logout button
        const profileLogoutBtn = document.getElementById('profileLogoutBtn');
        if (profileLogoutBtn) {
          profileLogoutBtn.onclick = () => {
            auth.signOut();
          };
        }

        closeModal();
      } else {
        idToken = null;
        localStorage.removeItem('firebaseIdToken');
        if (userProfileWidget) {
          userProfileWidget.style.display = 'none';
        }
        
        // Reset navbar CTA to Login text
        if (navLoginBtn) {
          navLoginBtn.classList.remove('nav-avatar-btn');
          navLoginBtn.textContent = 'Login';
        }

        // Show auth headers and tabs, hide profileView
        if (authTabsHeader) authTabsHeader.style.display = 'flex';
        loggedOutPanels.forEach(el => el.style.display = 'block');
        loggedInPanels.forEach(el => el.style.display = 'none');
        if (profileView) profileView.style.display = 'none';

        // Auto-show sign-in tab by default when logged out
        const signinTab = document.getElementById('signin-tab');
        if (signinTab) {
          document.querySelectorAll('.tab-btn').forEach(btn => {
            if (btn.dataset.tab === 'signin-tab') btn.classList.add('active');
            else btn.classList.remove('active');
          });
          document.querySelectorAll('.tab-content').forEach(c => {
            if (c.id === 'signin-tab') c.classList.add('active');
            else c.classList.remove('active');
          });
        }
        
        const emailInput = document.getElementById('customerEmail');
        const phoneInput = document.getElementById('customerPhone');
        if (emailInput) {
          emailInput.value = '';
          emailInput.readOnly = false;
        }
        if (phoneInput) {
          phoneInput.value = '';
          phoneInput.readOnly = false;
        }
      }
    });

    // Auto-open modal if URL contains ?login=true
    if (loginModal) {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('login') === 'true') {
        setTimeout(() => {
          if ((!auth || !auth.currentUser) && window.openLoginModal) {
            window.openLoginModal();
          }
        }, 800);
      }
    }

    // Sign Out Action
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (auth) auth.signOut();
      });
    }

    // 4. Social Auth Actions
    const googleLoginBtn = document.getElementById('googleLoginBtn');
    if (googleLoginBtn) {
      googleLoginBtn.addEventListener('click', async () => {
        if (!auth) return;
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
          await auth.signInWithPopup(provider);
        } catch (err) {
          console.error('Google Sign In Error:', err);
          alert(err.message);
        }
      });
    }

    const appleLoginBtn = document.getElementById('appleLoginBtn');
    if (appleLoginBtn) {
      appleLoginBtn.addEventListener('click', async () => {
        if (!auth) return;
        const provider = new firebase.auth.OAuthProvider('apple.com');
        try {
          await auth.signInWithPopup(provider);
        } catch (err) {
          console.error('Apple Sign In Error:', err);
          alert(err.message);
        }
      });
    }

    // 5. Email/Password Sign In
    const emailLoginForm = document.getElementById('emailLoginForm');
    if (emailLoginForm) {
      emailLoginForm.addEventListener('submit', async (e) => {
        if (!auth) return;
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        try {
          await auth.signInWithEmailAndPassword(email, password);
        } catch (err) {
          console.error('Email Sign In Error:', err);
          alert(err.message);
        }
      });
    }

    // Email/Password Registration
    const emailRegisterForm = document.getElementById('emailRegisterForm');
    if (emailRegisterForm) {
      emailRegisterForm.addEventListener('submit', async (e) => {
        if (!auth) return;
        e.preventDefault();
        const name = document.getElementById('registerName').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        try {
          const userCredential = await auth.createUserWithEmailAndPassword(email, password);
          await userCredential.user.updateProfile({ displayName: name });
          auth.currentUser.reload();
        } catch (err) {
          console.error('Registration Error:', err);
          alert(err.message);
        }
      });
    }

    // Password Reset Recovery
    const forgotPasswordForm = document.getElementById('forgotPasswordForm');
    if (forgotPasswordForm) {
      forgotPasswordForm.addEventListener('submit', async (e) => {
        if (!auth) return;
        e.preventDefault();
        const email = document.getElementById('forgotEmail').value;
        try {
          await auth.sendPasswordResetEmail(email);
          alert('Password reset link sent to your email.');
        } catch (err) {
          console.error('Password Reset Error:', err);
          alert(err.message);
        }
      });
    }

    // 6. Mobile OTP Sign In
    const phoneLoginForm = document.getElementById('phoneLoginForm');
    const phoneVerificationForm = document.getElementById('phoneVerificationForm');

    if (phoneLoginForm && phoneVerificationForm) {
      phoneLoginForm.addEventListener('submit', async (e) => {
        if (!auth) return;
        e.preventDefault();
        const phoneNumber = document.getElementById('loginPhone').value.trim();
        if (!phoneNumber.startsWith('+')) {
          alert('Please enter your phone number with country code (e.g. +91xxxxxxxxxx)');
          return;
        }
        const sendOtpBtn = document.getElementById('sendOtpBtn');
        sendOtpBtn.disabled = true;
        sendOtpBtn.textContent = 'Sending OTP...';
        
        try {
          confirmationResult = await auth.signInWithPhoneNumber(phoneNumber, window.recaptchaVerifier);
          phoneLoginForm.style.display = 'none';
          phoneVerificationForm.style.display = 'block';
        } catch (err) {
          console.error('Phone SMS Sending Error:', err);
          alert(err.message);
          sendOtpBtn.disabled = false;
          sendOtpBtn.textContent = 'Send OTP';
        }
      });

      phoneVerificationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('otpCode').value.trim();
        if (!confirmationResult) return;
        try {
          await confirmationResult.confirm(code);
        } catch (err) {
          console.error('OTP Verification Error:', err);
          alert('Invalid OTP code. Please try again.');
        }
      });
    }

    // 7. Intercept Ticket Form Submission if not Logged In
    if (submitPaymentBtn) {
      submitPaymentBtn.addEventListener('click', (e) => {
        if (!auth || !auth.currentUser) {
          e.preventDefault();
          e.stopPropagation();
          openModal();
        }
      });
    }

  })();

});
