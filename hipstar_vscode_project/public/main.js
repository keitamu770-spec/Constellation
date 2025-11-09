
// main.js - loads tile_index.json, tiles, filters visible stars via astronomy-engine, draws with Three.js
(async function(){
  const canvas = document.getElementById('canvas');
  const magSelect = document.getElementById('magLimit');
  const datetimeInput = document.getElementById('datetime');
  const latInput = document.getElementById('lat');
  const lonInput = document.getElementById('lon');
  const nowBtn = document.getElementById('nowBtn');
  const loadBtn = document.getElementById('loadBtn');

  const renderer = new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setSize(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', ()=> renderer.setSize(window.innerWidth, window.innerHeight));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.01, 10);
  camera.position.z = 1.2;
  scene.add(new THREE.AmbientLight(0xffffff,0.9));

  let tileIndex = [];
  let tilesCache = {};
  let pointsObj = null;
  let lineGroup = null;

  async function loadIndex(){
    tileIndex = await (await fetch('tile_index.json')).json();
    console.log('Tile index loaded', tileIndex.length);
  }

  function setNow(){
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset()*60000).toISOString().slice(0,16);
    datetimeInput.value = local;
  }
  setNow();
  nowBtn.addEventListener('click', setNow);

  async function loadTilesForMag(limitMag){
    const selected = tileIndex.filter(t => t.mag_max <= limitMag);
    const combined = [];
    for(const t of selected){
      if(tilesCache[t.file]) { combined.push(...tilesCache[t.file]); continue; }
      const arr = await (await fetch(t.file)).json();
      tilesCache[t.file]=arr;
      combined.push(...arr);
    }
    return combined;
  }

  function applyRotationAndFilter(stars, date, lat, lon){
    const obs = new Astronomy.Observer(lat, lon, 0);
    const time = Astronomy.Time(date);
    const rot = Astronomy.Rotation_EQJ_HOR(time, obs);
    const visible = [];
    for(const s of stars){
      const vec = {x:s.x,y:s.y,z:s.z};
      const vhor = Astronomy.RotateVector(rot, vec);
      const hor = Astronomy.HorizonFromVector(vhor, 'normal');
      if(hor.altitude > 0){
        visible.push({vhor:vhor, star:s, az:hor.azimuth, alt:hor.altitude});
      }
    }
    return visible;
  }

  function buildPointCloud(visibleStars){
    const n = visibleStars.length;
    const positions = new Float32Array(n*3);
    const sizes = new Float32Array(n);
    for(let i=0;i<n;i++){
      const vh = visibleStars[i].vhor;
      positions[i*3+0] = vh.x;
      positions[i*3+1] = vh.y;
      positions[i*3+2] = vh.z;
      const mag = visibleStars[i].star.mag;
      sizes[i] = Math.max(0.6, 5.5 - mag); // size mapping
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions,3));
    geom.setAttribute('size', new THREE.BufferAttribute(sizes,1));

    const material = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xffffff) } },
      vertexShader: `
        attribute float size;
        void main(){
          vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (180.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        void main(){
          float r = length(gl_PointCoord - vec2(0.5));
          if(r > 0.5) discard;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    if(pointsObj) scene.remove(pointsObj);
    pointsObj = new THREE.Points(geom, material);
    scene.add(pointsObj);
  }

  async function drawConstellations(date, lat, lon){
    const cons = await (await fetch('constellations.json')).json();
    if(lineGroup) scene.remove(lineGroup);
    lineGroup = new THREE.Group();
    const rot = Astronomy.Rotation_EQJ_HOR(Astronomy.Time(date), new Astronomy.Observer(lat, lon, 0));
    for(const c of cons){
      const pts = [];
      for(const s of c.stars){
        const ra = s.ra_hours * Math.PI / 12.0;
        const dec = s.dec_deg * Math.PI / 180.0;
        const vec = {x: Math.cos(dec)*Math.cos(ra), y: Math.cos(dec)*Math.sin(ra), z: Math.sin(dec)};
        const vhor = Astronomy.RotateVector(rot, vec);
        const hor = Astronomy.HorizonFromVector(vhor, 'normal');
        if(hor.altitude > 0) pts.push(new THREE.Vector3(vhor.x, vhor.y, vhor.z)); else pts.push(null);
      }
      const mat = new THREE.LineBasicMaterial({color:0x88ccff, linewidth:1});
      for(const ln of c.lines){
        const a = pts[ln[0]], b = pts[ln[1]];
        if(a && b){
          const geom = new THREE.BufferGeometry().setFromPoints([a,b]);
          const line = new THREE.Line(geom, mat);
          lineGroup.add(line);
        }
      }
      const vis = pts.filter(p => p !== null);
      if(vis.length > 0){
        const cx = vis.reduce((s,p)=>s+p.x,0)/vis.length;
        const cy = vis.reduce((s,p)=>s+p.y,0)/vis.length;
        const cz = vis.reduce((s,p)=>s+p.z,0)/vis.length;
        const sprite = makeTextSprite(c.name);
        sprite.position.set(cx,cy,cz);
        lineGroup.add(sprite);
      }
    }
    scene.add(lineGroup);
  }

  function makeTextSprite(message){
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(255,240,200,0.95)';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(message, 128, 64);
    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({map: texture, depthTest: false});
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.2,0.08,1);
    return sprite;
  }

  loadBtn.addEventListener('click', async ()=>{
    loadBtn.disabled = true;
    const dateStr = datetimeInput.value;
    const date = dateStr ? new Date(dateStr) : new Date();
    const lat = parseFloat(latInput.value) || 35.68;
    const lon = parseFloat(lonInput.value) || 139.76;
    const magLimit = parseFloat(magSelect.value) || 6;
    const stars = await loadTilesForMag(magLimit);
    const visible = applyRotationAndFilter(stars, date, lat, lon);
    console.log('Visible stars:', visible.length);
    buildPointCloud(visible);
    await drawConstellations(date, lat, lon);
    loadBtn.disabled = false;
  });

  // initial load
  await loadIndex();
  // preload mag 6
  magSelect.value = '6';
  loadBtn.click();

  function animate(){
    requestAnimationFrame(animate);
    if(pointsObj) pointsObj.rotation.y += 0.0006;
    renderer.render(scene, camera);
  }
  animate();

})();
