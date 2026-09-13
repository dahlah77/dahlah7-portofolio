import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js';

const canvas = document.querySelector('#scene');
const loader = document.querySelector('#loader');
const fallback = document.querySelector('#webglFallback');
const chapters = [...document.querySelectorAll('.chapter')];
const progressEl = document.querySelector('#sceneProgress');
const sceneIndex = document.querySelector('#sceneIndexItems');

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

let renderer, scene, camera, clock, water, dust, currentProgress = 0;
let pointerX = 0, pointerY = 0;
let atmosphere = { brightness: .72, temperature: .42, preset: 'custom' };
let sun, hemi, warmLights = [];
let reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const cameraStops = [
  { p: [31, 13.5, 33], t: [0, 5.2, 0] },
  { p: [23, 7.2, 19],  t: [0, 4.1, 0] },
  { p: [11, 7.0, 11],  t: [-2, 4.1, -1] },
  { p: [5, 5.4, 7],    t: [-5, 3.2, -4] },
  { p: [-2, 3.6, 12],  t: [-7, 2.2, -9] },
  { p: [1, 7.7, 1],    t: [5.8, 6.4, -1] },
  { p: [11, 10.2, -3], t: [0, 8.7, -4] },
  { p: [0, 14.1, -6],  t: [-8, 11.2, -8] },
  { p: [-22, 15, 23],  t: [0, 6.3, -2] },
  { p: [22, 11, -20],  t: [0, 6.2, -1] },
  { p: [30, 18, 31],   t: [0, 5.5, -1] }
];

function makeMat(color, roughness=.55, metalness=.02) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function box(name, size, pos, material, opts={}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...pos);
  mesh.castShadow = opts.cast ?? true;
  mesh.receiveShadow = opts.receive ?? true;
  if (opts.rotY) mesh.rotation.y = opts.rotY;
  scene.add(mesh);
  return mesh;
}

function cylinder(name, radius, height, pos, material, radial=20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, radial), material);
  mesh.name = name;
  mesh.position.set(...pos);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function initThree() {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.25 : 1.6));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .72;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07111b);
    scene.fog = new THREE.FogExp2(0x07111b, .012);

    camera = new THREE.PerspectiveCamera(39, innerWidth / innerHeight, .1, 180);
    camera.position.fromArray(cameraStops[0].p);
    camera.lookAt(new THREE.Vector3(...cameraStops[0].t));

    clock = new THREE.Clock();
    createLights();
    createEnvironment();
    createResidence();
    createLandscape();
    createAtmosphere();
    applyAtmosphere();

    setTimeout(() => loader.classList.add('is-done'), 1200);
    animate();
  } catch (err) {
    console.error(err);
    fallback.hidden = false;
    loader.classList.add('is-done');
  }
}

function createLights() {
  hemi = new THREE.HemisphereLight(0xcce2ee, 0x20201a, 1.05);
  scene.add(hemi);

  sun = new THREE.DirectionalLight(0xfff1d3, 3.1);
  sun.position.set(18, 30, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(innerWidth < 700 ? 1024 : 2048, innerWidth < 700 ? 1024 : 2048);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 75;
  sun.shadow.bias = -.00012;
  scene.add(sun);

  const specs = [
    [[-7,3.6,-4], 7.2, 16], [[5,3.8,-3], 6.0, 13], [[2,7.0,-2], 4.5, 12],
    [[-2,10.2,-4], 4.1, 11], [[-7,12.0,-8], 3.8, 10], [[-8,2.2,-10], 3.5, 10]
  ];
  specs.forEach(([pos,intensity,distance]) => {
    const light = new THREE.PointLight(0xffc078, intensity, distance, 2.0);
    light.position.set(...pos);
    scene.add(light);
    warmLights.push(light);
  });
}

function createEnvironment() {
  const groundMat = makeMat(0x29312c, .94, 0);
  const stoneMat = makeMat(0x5f615d, .8, 0);
  box('site', [76, .35, 76], [0, -.25, 0], groundMat, { cast:false });
  box('driveway', [18, .11, 38], [20, -.01, 12], stoneMat, { cast:false });
  box('entry-walk', [8, .13, 28], [5, .02, 14], makeMat(0x929087,.82), { cast:false });

  const wallMat = makeMat(0x282d2e,.92);
  box('boundary-n', [76,2.8,.35], [0,1.25,-37], wallMat);
  box('boundary-w', [.35,2.8,76], [-37,1.25,0], wallMat);
  box('boundary-e', [.35,2.8,76], [37,1.25,0], wallMat);
}

function createResidence() {
  const concrete = makeMat(0xc8c4ba,.68,0);
  const warmConcrete = makeMat(0xa9a59a,.72,0);
  const dark = makeMat(0x171c1f,.52,.12);
  const stone = makeMat(0x787469,.86,0);
  const wood = makeMat(0x6f4930,.58,0);
  const woodDark = makeMat(0x3f2d22,.7,0);
  const brass = makeMat(0x9a7a4d,.34,.58);
  const white = makeMat(0xe3e0d8,.7,0);
  const fabric = makeMat(0x77746d,.9,0);
  const glass = new THREE.MeshPhysicalMaterial({ color:0x9ec5cf, roughness:.07, metalness:0, transmission:.68, transparent:true, opacity:.43, thickness:.18, ior:1.46, clearcoat:.45, clearcoatRoughness:.12 });

  box('slab-1', [28,.5,22], [0,.35,-1], concrete);
  box('slab-2', [24,.45,18], [1,4.75,-2], concrete);
  box('slab-3', [20,.42,15], [-1,9.15,-3], concrete);
  box('roof', [23,.45,18], [-1,13.35,-3], dark);
  box('wall-west', [.55,4.1,15], [-13.6,2.5,-1.2], concrete);
  box('wall-north', [11,4.1,.5], [-8,2.5,-11.3], stone);
  box('core', [5,12.4,6], [5.8,6.5,-1], stone);
  box('entry-stone', [4,4.2,8], [9.8,2.5,6.5], stone);
  box('floating-canopy', [13,.35,8], [8.5,4.7,8.8], dark);
  box('entry-column-a', [.45,4.2,.45], [3.5,2.45,10.4], dark);
  box('entry-column-b', [.45,4.2,.45], [13.5,2.45,10.4], dark);

  box('glass-living', [15,3.55,.16], [-3.5,2.45,10], glass, {cast:false});
  box('glass-pool', [.16,3.45,10], [-13.2,2.45,-3.0], glass, {cast:false});
  box('glass-upper', [10,3.55,.14], [-5.2,6.75,6.85], glass, {cast:false});
  box('glass-master', [11,3.45,.14], [-4.4,11,4.25], glass, {cast:false});
  box('court-frame-a', [.35,12,8.6], [0,6.45,-2], dark);
  box('court-frame-b', [8.5,.3,.35], [-4.1,12.3,-2], dark);
  box('court-frame-c', [8.5,.3,.35], [-4.1,.6,-2], dark);
  for (let i=0;i<14;i++) box(`fin-${i}`, [.12,3.5,.28], [-10.2 + i*.72,6.8,7.25], woodDark);

  box('pool-bed',[14,.25,7],[-8,.05,-13],makeMat(0x5a7e82,.28,0),{cast:false});
  box('pool-coping-n',[15,.28,.5],[-8,.24,-9.25],warmConcrete);
  box('pool-coping-s',[15,.28,.5],[-8,.24,-16.75],warmConcrete);
  box('pool-coping-w',[.5,.28,7.9],[-15.25,.24,-13],warmConcrete);
  box('pool-coping-e',[.5,.28,7.9],[-.75,.24,-13],warmConcrete);
  const waterGeo = new THREE.PlaneGeometry(13.9,6.7,40,20);
  const waterMat = new THREE.MeshPhysicalMaterial({color:0x2f6f78,roughness:.16,metalness:.02,transmission:.25,transparent:true,opacity:.78,clearcoat:1,clearcoatRoughness:.08});
  water = new THREE.Mesh(waterGeo,waterMat);
  water.rotation.x=-Math.PI/2; water.position.set(-8,.27,-13); water.receiveShadow=true; scene.add(water);
  water.userData.base = Float32Array.from(waterGeo.attributes.position.array);

  box('living-floor',[12,.09,9],[-6,.66,3],makeMat(0x9c9585,.8),{cast:false});
  box('dining-floor',[8,.09,9],[5,.66,3],makeMat(0x685649,.76),{cast:false});
  box('sofa-seat',[5.8,.55,2.2],[-6,1.05,3.4],fabric);
  box('sofa-back',[5.8,1.15,.45],[-6,1.55,4.2],fabric);
  box('sofa-chaise',[2.2,.55,3.5],[-8.1,1.05,1.4],fabric);
  box('coffee-table',[3.4,.25,1.6],[-5.7,1.02,.1],dark);
  cylinder('coffee-base',.24,.75,[-5.7,.78,.1],brass,18);
  box('media-wall',[7,2.8,.35],[-8.5,2.25,-1.4],stone);
  box('tv',[4.2,2,.10],[-8.3,2.45,-1.62],dark,{cast:false});
  box('dining-top',[4.8,.22,1.8],[3.2,1.5,3.2],wood);
  box('dining-leg-a',[.25,1.2,.25],[1.5,1,3.2],dark);
  box('dining-leg-b',[.25,1.2,.25],[4.9,1,3.2],dark);
  for(let i=0;i<6;i++){ const x = 1.3 + (i%3)*1.9, z = i<3 ? 1.9 : 4.5; box(`chair-${i}`,[.85,.8,.85],[x,1.15,z],woodDark); }
  box('kitchen-island',[4.8,1,1.5],[5.8,1.22,-3.8],stone);
  box('kitchen-top',[5,.12,1.65],[5.8,1.78,-3.8],white);
  for(let i=0;i<3;i++) box(`stool-${i}`,[.55,.72,.55],[4.1+i*1.2,1.02,-2.45],woodDark);
  for(let i=0;i<16;i++){ const y=.95+i*.24, x=.8+i*.28, z=-1.1-i*.31; box(`stair-${i}`,[2.5,.18,.62],[x,y,z],woodDark); }
  box('stair-spine',[.22,4.9,.22],[3.1,3.0,-3.6],dark,{rotY:-.18});
  box('upper-west-wall',[.45,3.5,11],[-10.8,6.9,-2],concrete);
  box('upper-north-wall',[10,3.5,.45],[-6.0,6.9,-9.1],concrete);
  box('master-headboard',[7,2.3,.35],[-5.2,10.7,-8.2],wood);
  box('master-bed',[4.7,.55,6],[-5.2,9.8,-4.9],white);
  box('master-bed-top',[4.5,.25,5.8],[-5.2,10.2,-4.9],fabric);
  box('bench',[3.2,.52,1],[-5.2,9.85,-1.1],woodDark);
  box('gym-floor',[8,.1,6],[-6,9.65,-5.2],makeMat(0x2c3030,.86),{cast:false});
  for(let i=0;i<3;i++) cylinder(`weight-${i}`,.35,.22,[-8+i*.8,10.05,-6.6],dark,18).rotation.z=Math.PI/2;
  box('gym-bench',[2.5,.32,.8],[-6.1,10.0,-4.6],fabric,{rotY:.25});
  box('sauna',[5,3.1,4],[5.0,11,-6.4],wood);
  box('sauna-door',[1.6,2.5,.12],[5.0,10.8,-4.35],glass,{cast:false});

  const stripMat = new THREE.MeshStandardMaterial({color:0xffd2a1,emissive:0xff9f4b,emissiveIntensity:2.5,roughness:.4});
  box('strip-living',[7,.035,.09],[-5,4.52,1.6],stripMat,{cast:false});
  box('strip-court',[.08,8,.08],[.25,6.2,-6.1],stripMat,{cast:false});
  box('strip-upper',[8,.035,.09],[-5,8.9,5.7],stripMat,{cast:false});
}

function createLandscape(){
  const trunkMat=makeMat(0x5a4635,.92), leafA=makeMat(0x354d3a,.9), leafB=makeMat(0x466245,.88);
  const treeSpots=[[-23,-16,1.2],[-27,5,1.5],[-22,20,1.3],[18,-21,1.4],[25,-12,1.2],[26,22,1.5],[-27,-28,1.25]];
  treeSpots.forEach(([x,z,s])=>{
    const group=new THREE.Group();
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.32*s,.46*s,5*s,10),trunkMat);
    trunk.position.y=2.5*s; trunk.castShadow=true; group.add(trunk);
    for(let j=0;j<5;j++){
      const crown=new THREE.Mesh(new THREE.IcosahedronGeometry((1.8+Math.random()*.6)*s,1),j%2?leafA:leafB);
      crown.position.set((Math.random()-.5)*1.8*s,4.8*s+Math.random()*2*s,(Math.random()-.5)*1.8*s); crown.scale.y=1.2; crown.castShadow=true; group.add(crown);
    }
    group.position.set(x,0,z); scene.add(group);
  });
  const shrub=makeMat(0x38513b,.95);
  for(let i=0;i<42;i++){ const a=i/42*Math.PI*2, r=22+Math.sin(i*1.7)*5; const m=new THREE.Mesh(new THREE.IcosahedronGeometry(.45+Math.random()*.35,1),shrub); m.position.set(Math.cos(a)*r,.42,Math.sin(a)*r); m.scale.y=.75; m.castShadow=true; scene.add(m); }
}

function createAtmosphere(){
  const count=220, positions=new Float32Array(count*3);
  for(let i=0;i<count;i++){ positions[i*3]=(Math.random()-.5)*62; positions[i*3+1]=Math.random()*18+.8; positions[i*3+2]=(Math.random()-.5)*62; }
  const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const mat=new THREE.PointsMaterial({color:0xd8cdbb,size:.045,transparent:true,opacity:.38,depthWrite:false});
  dust=new THREE.Points(geo,mat); scene.add(dust);
}

function updateWater(time){
  if(!water) return;
  const attr=water.geometry.attributes.position, base=water.userData.base;
  for(let i=0;i<attr.count;i++){ const x=base[i*3], y=base[i*3+1]; attr.array[i*3+2]=Math.sin(x*.7+time*1.15)*.035 + Math.cos(y*.95-time*.8)*.023; }
  attr.needsUpdate=true; water.geometry.computeVertexNormals();
}

function sampleStops(progress){
  const max=cameraStops.length-1, scaled=clamp(progress)*max, i=Math.min(max-1,Math.floor(scaled)), t=ease(scaled-i), a=cameraStops[i], b=cameraStops[i+1];
  const pos=new THREE.Vector3(lerp(a.p[0],b.p[0],t),lerp(a.p[1],b.p[1],t),lerp(a.p[2],b.p[2],t));
  const target=new THREE.Vector3(lerp(a.t[0],b.t[0],t),lerp(a.t[1],b.t[1],t),lerp(a.t[2],b.t[2],t));
  return {pos,target};
}

function targetScrollProgress(){ const maxScroll=Math.max(1,document.documentElement.scrollHeight-innerHeight); return clamp(scrollY/maxScroll); }

function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05), elapsed=clock.elapsedTime, target=targetScrollProgress();
  currentProgress = reducedMotion ? target : THREE.MathUtils.damp(currentProgress,target,1.55,dt);
  const {pos,target:look}=sampleStops(currentProgress), parallax = innerWidth > 760 ? .35 : .12;
  camera.position.copy(pos); camera.position.x += pointerX*parallax; camera.position.y += pointerY*parallax*.45; look.x += pointerX*.15; look.y += pointerY*.08; camera.lookAt(look);
  updateWater(elapsed); if(dust){ dust.rotation.y=elapsed*.006; dust.position.y=Math.sin(elapsed*.12)*.08; } renderer.render(scene,camera);
}

function updateActiveChapter(){
  const mid=innerHeight*.52; let active=0, best=Infinity;
  chapters.forEach((chapter,i)=>{ const r=chapter.getBoundingClientRect(), d=Math.abs((r.top+r.height*.5)-mid); if(d<best){best=d;active=i;} chapter.classList.toggle('is-active',d<innerHeight*.66); });
  [...sceneIndex.children].forEach((btn,i)=>btn.classList.toggle('is-active',i===active)); progressEl.style.height=`${targetScrollProgress()*100}%`;
}

function buildIndex(){
  chapters.forEach((chapter,i)=>{ const b=document.createElement('button'); b.type='button'; b.textContent=chapter.dataset.label||String(i+1).padStart(2,'0'); b.setAttribute('aria-label',`Ke bagian ${chapter.dataset.label||i+1}`); b.addEventListener('click',()=>chapter.scrollIntoView({behavior:reducedMotion?'auto':'smooth',block:'center'})); sceneIndex.appendChild(b); }); updateActiveChapter();
}

function applyAtmosphere(){
  if(!renderer) return;
  const b=atmosphere.brightness; renderer.toneMappingExposure=lerp(.48,1.08,clamp(b)); sun.intensity=lerp(1.35,4.15,clamp(b)); hemi.intensity=lerp(.5,1.35,clamp(b));
  const temp=clamp(atmosphere.temperature), warm=new THREE.Color(0xff9c5a), neutral=new THREE.Color(0xfff4dd), c=neutral.clone().lerp(warm,temp);
  sun.color.copy(new THREE.Color(0xfff5dd).lerp(new THREE.Color(0xffc184),temp*.72)); warmLights.forEach((light,i)=>{ light.color.copy(c); light.intensity=(4.2+i*.15)*lerp(.55,1.35,b); });
  scene.fog.color.copy(new THREE.Color(0x07111b).lerp(new THREE.Color(0x171009),temp*.16)); scene.background.copy(new THREE.Color(0x07111b).lerp(new THREE.Color(0x120d08),temp*.09));
}

function setupControls(){
  const panel=document.querySelector('#sceneControls'), toggle=document.querySelector('#controlsToggle'), close=document.querySelector('#controlsClose'), brightness=document.querySelector('#brightness'), temperature=document.querySelector('#temperature'), bOut=document.querySelector('#brightnessValue'), tOut=document.querySelector('#temperatureValue');
  const setOpen=(open)=>{panel.classList.toggle('is-open',open);panel.setAttribute('aria-hidden',String(!open));toggle.setAttribute('aria-expanded',String(open));};
  toggle.addEventListener('click',()=>setOpen(!panel.classList.contains('is-open'))); close.addEventListener('click',()=>setOpen(false));
  brightness.addEventListener('input',()=>{atmosphere.brightness=+brightness.value/100;bOut.textContent=`${brightness.value}%`;applyAtmosphere();});
  temperature.addEventListener('input',()=>{atmosphere.temperature=+temperature.value/100;tOut.textContent=+temperature.value<30?'Cool':+temperature.value<62?'Neutral':'Warm';applyAtmosphere();});
  document.querySelectorAll('[data-preset]').forEach(btn=>btn.addEventListener('click',()=>{ const presets={day:[88,22],golden:[74,78],night:[42,66]}, [bv,tv]=presets[btn.dataset.preset]; brightness.value=bv;temperature.value=tv;atmosphere.brightness=bv/100; atmosphere.temperature=tv/100; bOut.textContent=`${bv}%`;tOut.textContent=tv<30?'Cool':tv<62?'Neutral':'Warm';applyAtmosphere(); }));
  document.querySelector('#fullscreen').addEventListener('click',async()=>{ try{ if(!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); }catch(e){console.warn('Fullscreen unavailable',e);} });
}

addEventListener('pointermove',e=>{ pointerX=(e.clientX/innerWidth-.5)*2; pointerY=(e.clientY/innerHeight-.5)*-2; },{passive:true});
addEventListener('scroll',updateActiveChapter,{passive:true});
addEventListener('resize',()=>{ if(!renderer||!camera)return; camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix(); renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<700?1.25:1.6));renderer.setSize(innerWidth,innerHeight,false); updateActiveChapter(); },{passive:true});
document.addEventListener('visibilitychange',()=>{ if(clock && !document.hidden) clock.getDelta(); });

buildIndex();
setupControls();
initThree();
