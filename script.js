(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gsap = window.gsap || null;
  const scrollToPlugin = window.ScrollToPlugin || null;
  if (gsap) {
    if (scrollToPlugin) gsap.registerPlugin(scrollToPlugin);
    document.documentElement.classList.add('has-gsap');
  }
  document.documentElement.classList.add('has-scroll-controller');

  // Programmatic page and anchor navigation shares one short, interruptible easing curve.
  const requestFrame = window.requestAnimationFrame?.bind(window) || ((callback) => window.setTimeout(() => callback(performance.now()), 16));
  const cancelFrame = window.cancelAnimationFrame?.bind(window) || window.clearTimeout.bind(window);
  let activeScrollCancel = null;
  const cancelActiveScroll = () => activeScrollCancel?.();
  ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((type) => {
    window.addEventListener(type, cancelActiveScroll, { passive: type !== 'keydown' });
  });

  const scrollToY = (requestedY) => {
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const targetY = Math.min(maxY, Math.max(0, requestedY));
    const startY = window.scrollY;
    const distance = targetY - startY;
    if (reducedMotion || Math.abs(distance) < 2) {
      window.scrollTo(0, targetY);
      return Promise.resolve(true);
    }

    const duration = Math.min(760, Math.max(360, Math.sqrt(Math.abs(distance)) * 24));
    if (gsap && scrollToPlugin) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (completed) => {
          if (settled) return;
          settled = true;
          if (activeScrollCancel === cancel) activeScrollCancel = null;
          resolve(completed);
        };
        let tween;
        const cancel = () => {
          tween?.kill();
          finish(false);
        };
        activeScrollCancel = cancel;
        tween = gsap.to(window, {
          duration: duration / 1000,
          ease: 'power3.inOut',
          scrollTo: { y: targetY, autoKill: true },
          onComplete: () => finish(true),
          onInterrupt: () => finish(false)
        });
      });
    }

    return new Promise((resolve) => {
      let frame = 0;
      let startTime = 0;
      let finished = false;
      const settle = (completed) => {
        if (finished) return;
        finished = true;
        if (frame) cancelFrame(frame);
        if (activeScrollCancel === cancel) activeScrollCancel = null;
        resolve(completed);
      };
      const cancel = () => settle(false);
      activeScrollCancel = cancel;

      const tick = (now) => {
        if (!startTime) startTime = now;
        const progress = Math.min(1, (now - startTime) / duration);
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        window.scrollTo(0, startY + distance * eased);
        if (progress < 1) frame = requestFrame(tick);
        else settle(true);
      };
      frame = requestFrame(tick);
    });
  };

  const targetScrollY = (target) => {
    const top = target.getBoundingClientRect().top + window.scrollY;
    const scrollPadding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    const scrollMargin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    return top - scrollPadding - scrollMargin;
  };
  const focusAfterScroll = (target) => {
    if (target === document.body) {
      const homeLink = document.querySelector('.site-header .brand');
      if (homeLink) focusAfterScroll(homeLink);
      return;
    }
    if (!target.matches('a,button,input,select,textarea,[tabindex]')) target.setAttribute('tabindex', '-1');
    const beforeFocus = window.scrollY;
    try { target.focus({ preventScroll: true }); }
    catch { target.focus(); window.scrollTo(0, beforeFocus); }
  };
  const pagePosition = () => `${window.location.pathname}${window.location.search}`;
  const findHashTarget = (hash) => {
    try { return document.getElementById(decodeURIComponent(hash.slice(1))); }
    catch { return document.getElementById(hash.slice(1)); }
  };

  // Complete a same-document anchor after a cross-page anchor link's top-to-top transition.
  try {
    const pending = JSON.parse(sessionStorage.getItem('ntg-pending-scroll') || 'null');
    if (pending && pending.path === pagePosition()) {
      sessionStorage.removeItem('ntg-pending-scroll');
      if (pending.hash) {
        const destination = findHashTarget(pending.hash);
        if (destination) {
          history.replaceState(history.state, '', `${pagePosition()}${pending.hash}`);
          requestFrame(() => scrollToY(targetScrollY(destination)).then((completed) => {
            if (completed) focusAfterScroll(destination);
          }));
        }
      }
    }
  } catch { /* Navigation still works normally when session storage is unavailable. */ }

  document.addEventListener('click', (event) => {
    const origin = event.target instanceof Element ? event.target : null;
    const link = origin?.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (link.target && link.target !== '_self' || link.hasAttribute('download')) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin !== window.location.origin) return;

    const samePage = destination.pathname === window.location.pathname && destination.search === window.location.search;
    if (samePage && destination.hash) {
      const target = findHashTarget(destination.hash);
      if (!target) return;
      event.preventDefault();
      if (reducedMotion) {
        history.pushState(history.state, '', destination.hash);
        window.scrollTo(0, targetScrollY(target));
        focusAfterScroll(target);
        return;
      }
      history.pushState(history.state, '', destination.hash);
      scrollToY(targetScrollY(target)).then((completed) => {
        if (completed) focusAfterScroll(target);
      });
      return;
    }

    if (samePage || destination.pathname === window.location.pathname && destination.search === window.location.search) return;
    event.preventDefault();
    const destinationPath = `${destination.pathname}${destination.search}`;
    const pending = { path: destinationPath, hash: destination.hash };
    try { sessionStorage.setItem('ntg-pending-scroll', JSON.stringify(pending)); }
    catch { window.location.assign(destination.href); return; }

    if (reducedMotion) {
      const targetUrl = `${destinationPath}${destination.hash}`;
      window.location.assign(targetUrl);
      return;
    }
    scrollToY(0).then((completed) => {
      if (!completed) {
        try { sessionStorage.removeItem('ntg-pending-scroll'); } catch { /* Ignore unavailable storage. */ }
        return;
      }
      window.location.assign(destinationPath);
    });
  });

  // Preserve browser Home/End behavior on the page while smoothing those page-level jumps.
  window.addEventListener('keydown', (event) => {
    if (reducedMotion || event.repeat || event.altKey || event.shiftKey) return;
    const goTop = event.key === 'Home' || (event.metaKey && event.key === 'ArrowUp');
    const goBottom = event.key === 'End' || (event.metaKey && event.key === 'ArrowDown');
    if (!goTop && !goBottom) return;
    const focused = event.target instanceof Element ? event.target : document.activeElement;
    if (focused.isContentEditable || focused.matches('input,textarea,select,[role="textbox"]')) return;
    event.preventDefault();
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    scrollToY(goTop ? 0 : maxY);
  });

  const revealItems = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window && !reducedMotion) {
    const siblings = new Map();
    revealItems.forEach((item) => {
      const parent = item.parentElement;
      const group = siblings.get(parent) || [];
      group.push(item);
      siblings.set(parent, group);
    });
    siblings.forEach((group) => group.forEach((item, index) => {
      item.style.setProperty('--reveal-delay', `${Math.min(index * 90, 360)}ms`);
    }));
    const observer = new IntersectionObserver((entries, activeObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const target = entry.target;
        const delay = (parseFloat(getComputedStyle(target).getPropertyValue('--reveal-delay')) || 0) / 1000;
        target.classList.add('is-visible');
        if (gsap) {
          gsap.fromTo(target, { y: 24, autoAlpha: 0 }, {
            y: 0, autoAlpha: 1, duration: 0.82, delay, ease: 'power3.out',
            clearProps: 'opacity,visibility,transform'
          });
          const images = target.querySelectorAll('img');
          if (images.length) gsap.fromTo(images, { clipPath: 'inset(4% 4% 4% 4%)', scale: 1.035 }, {
            clipPath: 'inset(0%)', scale: 1, duration: 1, delay, ease: 'power3.out', clearProps: 'clipPath,transform'
          });
        }
        activeObserver.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -42px 0px' });
    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  const menuButton = document.querySelector('.menu-toggle');
  const navigation = document.querySelector('.nav');
  if (menuButton && navigation) {
    const closeMenu = (restoreFocus = false) => {
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Open navigation');
      navigation.classList.remove('is-open');
      if (restoreFocus) menuButton.focus();
    };
    menuButton.addEventListener('click', () => {
      const open = menuButton.getAttribute('aria-expanded') !== 'true';
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      navigation.classList.toggle('is-open', open);
      if (open && gsap && !reducedMotion) gsap.fromTo(navigation.querySelectorAll('a'),
        { y: -6, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 0.28, ease: 'power2.out', stagger: 0.035, clearProps: 'transform,opacity,visibility' });
    });
    navigation.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => closeMenu()));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
        closeMenu(true);
      }
    });
  }

  // The catalog globe has a restrained pointer parallax on desktop; touch and reduced-motion stay static.
  const heroVisual = document.querySelector('.hero-visual');
  const emblem = document.querySelector('.hero-emblem-wrap');
  if (heroVisual && emblem && !reducedMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let frame = 0;
    const moveX = gsap ? gsap.quickTo(emblem, 'x', { duration: 0.55, ease: 'power3.out' }) : null;
    const moveY = gsap ? gsap.quickTo(emblem, 'y', { duration: 0.55, ease: 'power3.out' }) : null;
    heroVisual.addEventListener('pointermove', (event) => {
      if (frame) cancelFrame(frame);
      frame = requestFrame(() => {
        const bounds = heroVisual.getBoundingClientRect();
        const x = (event.clientX - bounds.left) / bounds.width - 0.5;
        const y = (event.clientY - bounds.top) / bounds.height - 0.5;
        if (gsap) { moveX(x * 9); moveY(y * 7); }
        else emblem.style.transform = `translate3d(${(x * 9).toFixed(1)}px, ${(y * 7).toFixed(1)}px, 0)`;
      });
    }, { passive: true });
    heroVisual.addEventListener('pointerleave', () => { if (gsap) { moveX(0); moveY(0); } else emblem.style.transform = ''; }, { passive: true });
  }

  // A soft gold/teal light follows the pointer over editorial cards on fine pointers only.
  if (!reducedMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.querySelectorAll('.value-card, .pillar, .industry-card, .method-step, .service-detail-photo').forEach((card) => {
      card.classList.add('spotlight');
      let frame = 0;
      let pointerX = 0;
      let pointerY = 0;
      if (gsap) { card.style.setProperty('--spot-x', '50%'); card.style.setProperty('--spot-y', '50%'); }
      const setSpotX = gsap ? gsap.quickTo(card, '--spot-x', { duration: 0.38, ease: 'power2.out' }) : null;
      const setSpotY = gsap ? gsap.quickTo(card, '--spot-y', { duration: 0.38, ease: 'power2.out' }) : null;
      card.addEventListener('pointermove', (event) => {
        const bounds = card.getBoundingClientRect();
        pointerX = event.clientX - bounds.left;
        pointerY = event.clientY - bounds.top;
        if (frame) return;
        frame = requestFrame(() => {
          frame = 0;
          if (gsap) { setSpotX(`${pointerX}px`); setSpotY(`${pointerY}px`); }
          else { card.style.setProperty('--spot-x', `${pointerX}px`); card.style.setProperty('--spot-y', `${pointerY}px`); }
        });
      }, { passive: true });
      card.addEventListener('pointerleave', () => {
        if (frame) cancelFrame(frame);
        frame = 0;
        if (gsap) { setSpotX('0px'); setSpotY('0px'); }
        else { card.style.removeProperty('--spot-x'); card.style.removeProperty('--spot-y'); }
      }, { passive: true });
    });

    // Small image drift and a local highlight follow the pointer without changing layout dimensions.
    document.querySelectorAll('.hero-photo, .home-service-card, .page-hero-image, .service-detail-photo, .industry-card, .brand-story-image, .contact-image').forEach((frame) => {
      const image = frame.querySelector(':scope > img');
      if (!image) return;
      frame.classList.add('pointer-photo');
      let pointerFrame = 0;
      let imageX = 0;
      let imageY = 0;
      if (gsap) {
        frame.style.setProperty('--photo-shift-x', '0px'); frame.style.setProperty('--photo-shift-y', '0px');
        frame.style.setProperty('--photo-pointer-x', '50%'); frame.style.setProperty('--photo-pointer-y', '50%');
      }
      const shiftX = gsap ? gsap.quickTo(frame, '--photo-shift-x', { duration: 0.48, ease: 'power2.out' }) : null;
      const shiftY = gsap ? gsap.quickTo(frame, '--photo-shift-y', { duration: 0.48, ease: 'power2.out' }) : null;
      const pointerX = gsap ? gsap.quickTo(frame, '--photo-pointer-x', { duration: 0.42, ease: 'power2.out' }) : null;
      const pointerY = gsap ? gsap.quickTo(frame, '--photo-pointer-y', { duration: 0.42, ease: 'power2.out' }) : null;
      frame.addEventListener('pointermove', (event) => {
        const bounds = frame.getBoundingClientRect();
        imageX = (event.clientX - bounds.left) / bounds.width;
        imageY = (event.clientY - bounds.top) / bounds.height;
        if (pointerFrame) return;
        pointerFrame = requestFrame(() => {
          pointerFrame = 0;
          if (gsap) {
            shiftX(`${((imageX - 0.5) * 4).toFixed(1)}px`); shiftY(`${((imageY - 0.5) * 4).toFixed(1)}px`);
            pointerX(`${(imageX * 100).toFixed(1)}%`); pointerY(`${(imageY * 100).toFixed(1)}%`);
          } else {
            frame.style.setProperty('--photo-shift-x', `${((imageX - 0.5) * 4).toFixed(1)}px`);
            frame.style.setProperty('--photo-shift-y', `${((imageY - 0.5) * 4).toFixed(1)}px`);
            frame.style.setProperty('--photo-pointer-x', `${(imageX * 100).toFixed(1)}%`);
            frame.style.setProperty('--photo-pointer-y', `${(imageY * 100).toFixed(1)}%`);
          }
        });
      }, { passive: true });
      frame.addEventListener('pointerleave', () => {
        if (pointerFrame) cancelFrame(pointerFrame);
        pointerFrame = 0;
        if (gsap) { shiftX('0px'); shiftY('0px'); pointerX('50%'); pointerY('50%'); }
        else {
          frame.style.removeProperty('--photo-shift-x'); frame.style.removeProperty('--photo-shift-y');
          frame.style.removeProperty('--photo-pointer-x'); frame.style.removeProperty('--photo-pointer-y');
        }
      }, { passive: true });
    });
  }

  // Accessible catalog-photo viewer. Existing linked service tiles stay links and are not intercepted.
  const lightbox = document.createElement('dialog');
  lightbox.className = 'image-lightbox';
  lightbox.setAttribute('aria-label', 'Expanded photograph');
  lightbox.innerHTML = '<button class="image-lightbox-close" type="button" aria-label="Close expanded photograph"><span aria-hidden="true">×</span></button><figure class="image-lightbox-figure"><img class="image-lightbox-image" alt=""><figcaption class="image-lightbox-caption"></figcaption></figure>';
  const supportsDialog = typeof lightbox.showModal === 'function';
  let lightboxTrigger = null;
  let lightboxClosing = false;
  let lightboxTimer = 0;
  let lightboxOrigin = { x: 0, y: 0, scale: 0.3 };
  const lightboxImage = lightbox.querySelector('.image-lightbox-image');
  const lightboxCaption = lightbox.querySelector('.image-lightbox-caption');
  const closeLightboxButton = lightbox.querySelector('.image-lightbox-close');

  const openLightbox = (trigger, photo) => {
    if (!supportsDialog || lightbox.open) return;
    lightboxTrigger = trigger;
    lightboxClosing = false;
    lightboxImage.src = photo.currentSrc || photo.src;
    lightboxImage.alt = photo.alt;
    lightboxCaption.textContent = photo.alt;
    const bounds = photo.getBoundingClientRect();
    const scale = Math.min(0.66, Math.max(0.2, bounds.width / Math.min(window.innerWidth * 0.92, 1100)));
    lightboxOrigin = {
      x: bounds.left + bounds.width / 2 - window.innerWidth / 2,
      y: bounds.top + bounds.height / 2 - window.innerHeight / 2,
      scale
    };
    lightbox.style.setProperty('--lightbox-x', `${(bounds.left + bounds.width / 2 - window.innerWidth / 2).toFixed(1)}px`);
    lightbox.style.setProperty('--lightbox-y', `${(bounds.top + bounds.height / 2 - window.innerHeight / 2).toFixed(1)}px`);
    lightbox.style.setProperty('--lightbox-scale', scale.toFixed(3));
    lightbox.classList.remove('is-open', 'is-closing');
    lightbox.showModal();
    try { closeLightboxButton.focus({ preventScroll: true }); }
    catch { closeLightboxButton.focus(); }
    if (reducedMotion) lightbox.classList.add('is-open');
    else requestFrame(() => {
      lightbox.classList.add('is-open');
      if (gsap) gsap.fromTo(lightbox,
        { opacity: 0, x: lightboxOrigin.x, y: lightboxOrigin.y, scale: lightboxOrigin.scale },
        { opacity: 1, x: 0, y: 0, scale: 1, duration: 0.46, ease: 'power3.out', clearProps: 'opacity,transform' });
    });
  };

  const finishLightboxClose = () => {
    if (!lightbox.open) return;
    window.clearTimeout(lightboxTimer);
    lightbox.close();
  };

  const closeLightbox = () => {
    if (!lightbox.open || lightboxClosing) return;
    lightboxClosing = true;
    if (reducedMotion) {
      finishLightboxClose();
      return;
    }
    lightbox.classList.remove('is-open');
    lightbox.classList.add('is-closing');
    if (gsap) gsap.to(lightbox, {
      opacity: 0, x: lightboxOrigin.x, y: lightboxOrigin.y, scale: lightboxOrigin.scale,
      duration: 0.38, ease: 'power2.in', onComplete: finishLightboxClose
    });
    else lightboxTimer = window.setTimeout(finishLightboxClose, 460);
  };

  if (supportsDialog) {
    const photoTriggerPairs = [];
    document.querySelectorAll('.hero-photo img, .page-hero-image img, .service-detail-photo img, .industry-card img, .brand-story-image img, .contact-image img').forEach((photo) => {
      if (!photo.alt || photo.closest('a')) return;
      const trigger = document.createElement('button');
      trigger.className = 'photo-zoom-trigger';
      trigger.type = 'button';
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-label', `View larger image: ${photo.alt}`);
      trigger.innerHTML = '<span aria-hidden="true">↗</span>';
      const syncTriggerBounds = () => {
        trigger.style.left = `${photo.offsetLeft}px`;
        trigger.style.top = `${photo.offsetTop}px`;
        trigger.style.width = `${photo.offsetWidth}px`;
        trigger.style.height = `${photo.offsetHeight}px`;
      };
      syncTriggerBounds();
      photoTriggerPairs.push(syncTriggerBounds);
      photo.setAttribute('aria-hidden', 'true');
      photo.parentElement.insertBefore(trigger, photo.nextSibling);
      trigger.addEventListener('click', () => openLightbox(trigger, photo));
    });
    window.addEventListener('resize', () => photoTriggerPairs.forEach((sync) => sync()), { passive: true });

    closeLightboxButton.addEventListener('click', closeLightbox);
    lightbox.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeLightbox();
    });
    lightbox.addEventListener('click', (event) => {
      if (event.target === lightbox) closeLightbox();
    });
    lightbox.addEventListener('close', () => {
      lightboxClosing = false;
      lightbox.classList.remove('is-open', 'is-closing');
      if (gsap) gsap.set(lightbox, { clearProps: 'opacity,transform' });
      if (lightboxTrigger?.isConnected) {
        try { lightboxTrigger.focus({ preventScroll: true }); }
        catch { lightboxTrigger.focus(); }
      }
      lightboxTrigger = null;
    });
    document.body.append(lightbox);
  }

  // One compositor-friendly progress line indicates how far the reader has moved through a page.
  if (!reducedMotion) {
    const progress = document.createElement('div');
    progress.className = 'motion-progress';
    progress.setAttribute('aria-hidden', 'true');
    document.body.append(progress);
    let scrollFrame = 0;
    const updateProgress = () => {
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(() => {
        const range = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.transform = `scaleX(${range > 0 ? window.scrollY / range : 0})`;
      });
    };
    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress, { passive: true });
    updateProgress();
  }

  // The site currently uses one strictly functional cookie for the notice preference only.
  const cookieName = 'ntg_cookie_notice';
  const cookieAcknowledged = () => document.cookie.split(';').some((item) => item.trim().startsWith(`${cookieName}=`));
  const cookieNotice = document.createElement('aside');
  cookieNotice.className = 'cookie-notice';
  cookieNotice.setAttribute('aria-label', 'Cookie information');
  cookieNotice.hidden = true;
  cookieNotice.innerHTML = '<div><strong>Cookie information</strong><p>This site uses one necessary cookie to remember this notice. No analytics or advertising cookies are currently used. <a href="privacy.html#cookies">Cookie details</a></p></div><button class="button button-gold cookie-notice-dismiss" type="button">Got it</button>';
  document.body.append(cookieNotice);
  const dismissCookieNotice = () => {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${cookieName}=ack; Max-Age=15552000; Path=/; SameSite=Lax${secure}`;
    cookieNotice.hidden = true;
  };
  cookieNotice.querySelector('.cookie-notice-dismiss').addEventListener('click', dismissCookieNotice);
  if (!cookieAcknowledged()) cookieNotice.hidden = false;
  document.querySelectorAll('.footer-bottom').forEach((footer) => {
    const preferences = document.createElement('button');
    preferences.className = 'cookie-preferences';
    preferences.type = 'button';
    preferences.textContent = 'Cookie preferences';
    preferences.addEventListener('click', () => {
      document.cookie = `${cookieName}=; Max-Age=0; Path=/; SameSite=Lax`;
      cookieNotice.hidden = false;
      cookieNotice.querySelector('.cookie-notice-dismiss').focus();
    });
    footer.append(preferences);
  });

  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });
  const form = document.getElementById('contact-form');
  const status = document.getElementById('form-status');
  if (form && status) {
    const serviceFromUrl = new URLSearchParams(window.location.search).get('service');
    const select = form.querySelector('[name="service"]');
    if (serviceFromUrl && select) {
      const match = Array.from(select.options).find((option) => option.value.toLowerCase().includes(serviceFromUrl.toLowerCase()));
      if (match) select.value = match.value;
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      status.textContent = 'Thanks for reaching out. This demonstration form is not connected yet; add your form endpoint to receive enquiries.';
      status.classList.add('success');
    });
  }
})();
