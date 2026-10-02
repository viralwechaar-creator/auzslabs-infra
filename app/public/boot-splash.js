(function(){
  var el=document.getElementById('boot-splash');
  if(!el)return;
  var hidden=false;
  function hide(){
    if(hidden)return;hidden=true;
    el.classList.add('hide');
    setTimeout(function(){el&&el.remove()},420);
  }
  var minDone=false,appDone=false;
  function tryHide(){if(minDone&&appDone)hide()}
  setTimeout(function(){minDone=true;tryHide()},900);
  var appEl=document.getElementById('app');
  if(!appEl||appEl.children.length){
    appDone=true;
  }else{
    var mo=new MutationObserver(function(){
      if(appEl.children.length){appDone=true;mo.disconnect();tryHide()}
    });
    mo.observe(appEl,{childList:true});
  }
  setTimeout(hide,4000); // safety: never block the app if boot stalls
})();
