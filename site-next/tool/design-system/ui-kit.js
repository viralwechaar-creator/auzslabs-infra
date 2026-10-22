/* AUZslab UI Kit — behavior. Vanilla JS, no dependencies.
   Each init() is idempotent and safe to call on any page that includes
   the matching markup; components with no matching elements are no-ops. */
(function(){

  function initAccordion(){
    document.querySelectorAll('.uk-accordion').forEach(function(acc){
      acc.querySelectorAll('.uk-accordion-head').forEach(function(head){
        head.addEventListener('click', function(){
          var item = head.closest('.uk-accordion-item');
          var wasOpen = item.classList.contains('is-open');
          if (acc.dataset.single !== 'false'){
            acc.querySelectorAll('.uk-accordion-item.is-open').forEach(function(o){
              if (o !== item) o.classList.remove('is-open');
            });
          }
          item.classList.toggle('is-open', !wasOpen);
        });
      });
    });
  }

  function initOverflowMenus(){
    document.querySelectorAll('.uk-overflow-menu').forEach(function(menu){
      var trigger = menu.querySelector('.uk-overflow-trigger');
      var panel = menu.querySelector('.uk-overflow-panel');
      if (!trigger || !panel) return;
      trigger.addEventListener('click', function(e){
        e.stopPropagation();
        var open = panel.classList.contains('is-open');
        document.querySelectorAll('.uk-overflow-panel.is-open').forEach(function(p){ p.classList.remove('is-open'); });
        document.querySelectorAll('.uk-overflow-trigger.is-open').forEach(function(t){ t.classList.remove('is-open'); });
        if (!open){ panel.classList.add('is-open'); trigger.classList.add('is-open'); }
      });
    });
    document.addEventListener('click', function(){
      document.querySelectorAll('.uk-overflow-panel.is-open').forEach(function(p){ p.classList.remove('is-open'); });
      document.querySelectorAll('.uk-overflow-trigger.is-open').forEach(function(t){ t.classList.remove('is-open'); });
    });
  }

  function initHamburgers(){
    document.querySelectorAll('.uk-hamburger[data-toggle-target]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var open = !btn.classList.contains('is-open');
        btn.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', String(open));
        var target = document.querySelector(btn.dataset.toggleTarget);
        if (target) target.classList.toggle('open', open);
      });
    });
  }

  function initTabbars(){
    document.querySelectorAll('.uk-tabbar').forEach(function(bar){
      var indicator = document.createElement('div');
      indicator.className = 'uk-tabbar-indicator';
      bar.insertBefore(indicator, bar.firstChild);

      function place(tab){
        if (!tab) return;
        indicator.style.width = tab.offsetWidth + 'px';
        indicator.style.transform = 'translateX(' + tab.offsetLeft + 'px)';
      }
      var tabs = Array.prototype.slice.call(bar.querySelectorAll('.uk-tab'));
      tabs.forEach(function(tab){
        tab.addEventListener('click', function(){
          tabs.forEach(function(t){ t.classList.remove('is-active'); });
          tab.classList.add('is-active');
          place(tab);
        });
      });
      requestAnimationFrame(function(){ place(bar.querySelector('.uk-tab.is-active') || tabs[0]); });
      window.addEventListener('resize', function(){ place(bar.querySelector('.uk-tab.is-active')); });
    });
  }

  function initPagination(){
    document.querySelectorAll('.uk-pagination[data-demo]').forEach(function(nav){
      nav.querySelectorAll('.uk-page-btn[data-page]').forEach(function(btn){
        btn.addEventListener('click', function(){
          nav.querySelectorAll('.uk-page-btn[data-page]').forEach(function(b){ b.classList.remove('is-active'); });
          btn.classList.add('is-active');
        });
      });
    });
  }

  function init(){
    initAccordion();
    initOverflowMenus();
    initHamburgers();
    initTabbars();
    initPagination();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.AUZUIKit = { init: init };
})();
