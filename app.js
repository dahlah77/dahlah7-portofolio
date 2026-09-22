const topbar=document.getElementById('topbar');
const menuBtn=document.getElementById('menuBtn');
const mobileMenu=document.getElementById('mobileMenu');
const progress=document.getElementById('pageProgress');
const glow=document.getElementById('cursorGlow');
const portrait=document.getElementById('heroPortrait');
const modal=document.getElementById('caseModal');
const closeModal=document.getElementById('modalClose');

function onScroll(){
  topbar.classList.toggle('scrolled',window.scrollY>30);
  const h=document.documentElement.scrollHeight-window.innerHeight;
  progress.style.width=(h?window.scrollY/h*100:0)+'%';
  if(portrait && window.innerWidth>720){
    const y=Math.min(window.scrollY,700)*.025;
    portrait.style.translate=`0 ${y}px`;
  }
}
window.addEventListener('scroll',onScroll,{passive:true});onScroll();

menuBtn.addEventListener('click',()=>{
  const open=mobileMenu.classList.toggle('open');
  menuBtn.textContent=open?'Close':'Menu';
  menuBtn.setAttribute('aria-expanded',String(open));
  mobileMenu.setAttribute('aria-hidden',String(!open));
});
document.querySelectorAll('.mobile-menu a').forEach(a=>a.addEventListener('click',()=>{
  mobileMenu.classList.remove('open');menuBtn.textContent='Menu';menuBtn.setAttribute('aria-expanded','false');mobileMenu.setAttribute('aria-hidden','true');
}));

if(window.matchMedia('(pointer:fine)').matches){
  window.addEventListener('pointermove',e=>{glow.style.left=e.clientX+'px';glow.style.top=e.clientY+'px';},{passive:true});
  document.querySelectorAll('.magnetic').forEach(el=>el.addEventListener('pointermove',e=>{
    const r=el.getBoundingClientRect();const x=e.clientX-r.left-r.width/2;const y=e.clientY-r.top-r.height/2;el.style.transform=`translate(${x*.08}px,${y*.08}px)`;
  }));
  document.querySelectorAll('.magnetic').forEach(el=>el.addEventListener('pointerleave',()=>el.style.transform=''));
}

const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{
  if(entry.isIntersecting){entry.target.classList.add('in');observer.unobserve(entry.target)}
}),{threshold:.12,rootMargin:'0px 0px -5%'});
document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));

const filters=document.querySelectorAll('.filter');
const cards=document.querySelectorAll('.project-card');
filters.forEach(btn=>btn.addEventListener('click',()=>{
  filters.forEach(x=>x.classList.remove('is-active'));btn.classList.add('is-active');
  const filter=btn.dataset.filter;
  cards.forEach(card=>{
    const show=filter==='all'||card.dataset.category.split(' ').includes(filter);
    card.classList.toggle('hidden',!show);
  });
}));

const projectData={
  architecture:{type:'WEB + ARCHITECTURE',title:'DAHLAH7 Architecture',summary:'An immersive portfolio direction for architectural work: cinematic scroll scenes, visual hierarchy, spatial storytelling and interactive presentation designed to make architecture feel experiential rather than static.',focus:'Interactive portfolio · 3D direction · responsive experience',status:'Active development'},
  ai:{type:'AI + AUTOMATION',title:'DAHLAH7 Personal OS',summary:'A personal ecosystem concept for iPhone and Mac that connects notes, reminders, finance tracking, savings, goals and automation into one consistent workflow.',focus:'Personal systems · automation · Apple ecosystem',status:'Concept / ongoing'},
  browser:{type:'WEB + AUTOMATION',title:'Browser Workflow Tools',summary:'Small browser utilities and extensions aimed at removing repetitive steps from everyday digital work and turning recurring actions into repeatable flows.',focus:'Browser extensions · JavaScript · workflow design',status:'Experiment / iteration'},
  render:{type:'ARCHITECTURE + 3D',title:'Architectural Visualization Studies',summary:'A continuing set of residential visualization studies exploring massing, materials, façade rhythm, interior/exterior lighting and presentation quality.',focus:'3D visualization · lighting · spatial composition',status:'Study series'},
  docs:{type:'AI + DOCUMENTS',title:'Document Automation Workflow',summary:'A structured approach for checking, revising and formatting long academic and business documents while preserving layout, references and content consistency.',focus:'Document QA · structured revision · automation',status:'Working workflow'},
  data:{type:'AI + RESEARCH',title:'Quantitative Research Experiments',summary:'Explorations around financial analysis, market data, repeatable research methods and analytical workflows that can be audited and reused.',focus:'Data analysis · financial research · repeatable workflows',status:'Experimental'}
};
function openCase(key){
  const d=projectData[key];if(!d)return;
  document.getElementById('caseType').textContent=d.type;
  document.getElementById('caseTitle').textContent=d.title;
  document.getElementById('caseSummary').textContent=d.summary;
  document.getElementById('caseFocus').textContent=d.focus;
  document.getElementById('caseStatus').textContent=d.status;
  modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.classList.add('lock');closeModal.focus();
}
function shutCase(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.body.classList.remove('lock')}
document.querySelectorAll('.project-open').forEach(btn=>btn.addEventListener('click',()=>openCase(btn.dataset.project)));
closeModal.addEventListener('click',shutCase);
modal.addEventListener('click',e=>{if(e.target===modal)shutCase()});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('open'))shutCase()});
