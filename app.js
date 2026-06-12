// ============================================================
//  ⚠️  EDITA ESTO:  la URL de tu Worker de Cloudflare
// ============================================================
//  Después de publicar el Worker, Cloudflare te da una URL como
//  https://magic-todo.tuusuario.workers.dev  — pégala aquí.
const WORKER_URL = "https://autumn-bar-b81f.90-tolls-rip.workers.dev";

// ============================================================
//  LOGIN  —  la contraseña se verifica en el Worker
// ============================================================
//  La guardamos en el navegador (en TU dispositivo, no en el
//  código público) y la mandamos en cada llamada al Worker.
const PASS_KEY = 'magic-todo-pass';

function getPass() {
  try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; }
}
function setPass(p) {
  try { localStorage.setItem(PASS_KEY, p); } catch (e) {}
}
function clearPass() {
  try { localStorage.removeItem(PASS_KEY); } catch (e) {}
}

function makeTask(text) {
  return { id: newId(), text, done: false, children: [], loading: false, collapsed: false };
}

const lockEl = document.getElementById('lock');
const passInput = document.getElementById('pass');
const enterBtn = document.getElementById('enter');
const lockError = document.getElementById('lockError');

function showLock(message) {
  lockEl.style.display = 'flex';
  lockError.textContent = message || '';
  passInput.value = '';
  passInput.focus();
}
function hideLock() { lockEl.style.display = 'none'; }

// Llamada central al Worker: añade la contraseña y maneja el 401.
async function callWorker(payload) {
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-Password": getPass(),
    },
    body: JSON.stringify(payload),
  });

  // 401 = contraseña incorrecta o vencida → de vuelta al login.
  if (res.status === 401) {
    clearPass();
    showLock('Contraseña incorrecta.');
    throw new Error('No autorizado');
  }

  if (!res.ok) {
    let msg = 'HTTP ' + res.status;
    try { const e = await res.json(); if (e.error) msg = e.error; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

// Intentar entrar: manda un ping de verificación al Worker.
async function tryLogin(pw) {
  enterBtn.disabled = true;
  lockError.textContent = 'Verificando…';
  setPass(pw);
  try {
    await callWorker({ verify: true });   // si la clave es mala, lanza y vuelve al login
    hideLock();
    lockError.textContent = '';
  } catch (e) {
    // callWorker ya mostró el error si fue 401
    if (e.message !== 'No autorizado') lockError.textContent = 'Error: ' + e.message;
  } finally {
    enterBtn.disabled = false;
  }
}

enterBtn.onclick = () => {
  const pw = passInput.value.trim();
  if (!pw) { passInput.focus(); return; }
  tryLogin(pw);
};
passInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') enterBtn.click();
});

document.getElementById('logout').onclick = () => {
  clearPass();
  showLock('Sesión cerrada.');
};

// ============================================================
//  PICANTE (igual que antes)
// ============================================================
const SPICE_LABELS = ['Muy suave', 'Suave', 'Normal', 'Detallado', 'Exhaustivo'];
const SPICE_RANGE  = { 1: [2,3], 2: [3,4], 3: [4,6], 4: [6,8], 5: [8,12] };
let spice = 3;

// ============================================================
//  ESTADO  +  MEMORIA (localStorage)
// ============================================================
//  Todo el estado vive en este objeto. Cada cambio se guarda.
//  Estructura:
//   state = {
//     activeId,        // id de la lista activa
//     nextId,          // contador para ids únicos
//     lists: [ { id, name, context, tasks: [ {id, text, done, children:[...]} ] } ]
//   }
const STORAGE_KEY = 'magic-todo-v2';
let state;

// Guardar: convertimos el objeto a texto y lo metemos en el navegador.
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { /* en algunos entornos (ej. previews) localStorage no está; no pasa nada */ }
}

// Cargar al arrancar: si no hay nada guardado, creamos una lista de ejemplo.
function load() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  if (saved) {
    try { state = JSON.parse(saved); return; } catch (e) {}
  }
  // Estado inicial por defecto
  state = {
    nextId: 1,
    activeId: 1,
    lists: [
      { id: 1, name: 'Trabajo', context: '', tasks: [] },
    ],
  };
  state.nextId = 2;
}

// Atajos útiles
function activeList() {
  return state.lists.find(l => l.id === state.activeId) || state.lists[0];
}
function newId() { return state.nextId++; }

// ============================================================
//  DIBUJAR LAS PESTAÑAS DE LISTAS
// ============================================================
const listsEl = document.getElementById('lists');

function renderLists() {
  listsEl.innerHTML = '';
  state.lists.forEach(l => {
    const b = document.createElement('button');
    b.className = 'list-chip' + (l.id === state.activeId ? ' active' : '');
    b.textContent = l.name || 'Sin nombre';
    b.onclick = () => { state.activeId = l.id; save(); renderAll(); };
    listsEl.appendChild(b);
  });
  // Chip para añadir una lista nueva
  const add = document.createElement('button');
  add.className = 'list-chip add';
  add.textContent = '+ lista';
  add.onclick = () => {
    const name = prompt('Nombre de la nueva lista:', 'Nueva lista');
    if (name === null) return;
    const id = newId();
    state.lists.push({ id, name: name.trim() || 'Nueva lista', context: '', tasks: [] });
    state.activeId = id;
    save(); renderAll();
  };
  listsEl.appendChild(add);
}

// ============================================================
//  PANEL DE CONTEXTO (nombre + contexto + borrar)
// ============================================================
const nameInput = document.getElementById('listName');
const ctxInput  = document.getElementById('listCtx');
const deleteBtn = document.getElementById('deleteList');

function syncCtxPanel() {
  const l = activeList();
  nameInput.value = l.name || '';
  ctxInput.value  = l.context || '';
}

// Al escribir, actualizamos el estado y guardamos.
nameInput.oninput = () => {
  activeList().name = nameInput.value;
  save();
  renderLists(); // para que la pestaña refleje el nuevo nombre
};
ctxInput.oninput = () => {
  activeList().context = ctxInput.value;
  save();
};

deleteBtn.onclick = () => {
  if (state.lists.length <= 1) {
    alert('No puedes borrar la única lista. Crea otra primero.');
    return;
  }
  const l = activeList();
  if (!confirm(`¿Borrar la lista "${l.name}" y todas sus tareas?`)) return;
  state.lists = state.lists.filter(x => x.id !== l.id);
  state.activeId = state.lists[0].id;
  save(); renderAll();
};

// ============================================================
//  AJÍES
// ============================================================
const peppersEl = document.getElementById('peppers');
const spiceLabelEl = document.getElementById('spiceLabel');
function renderPeppers() {
  peppersEl.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.className = 'pepper' + (i <= spice ? ' on' : '');
    b.textContent = '🌶️';
    b.title = SPICE_LABELS[i-1];
    b.onclick = () => { spice = i; renderPeppers(); };
    peppersEl.appendChild(b);
  }
  spiceLabelEl.textContent = SPICE_LABELS[spice - 1];
}

// ============================================================
//  LLAMADA AL WORKER  (ya NO a Anthropic directo)
// ============================================================
//  Le mandamos la tarea + el contexto de la lista activa.
//  El Worker arma el prompt, le pega la key y nos devuelve los pasos.
async function breakDown(text) {
  const [min, max] = SPICE_RANGE[spice];
  const ctx = activeList().context || '';

  const data = await callWorker({ task: text, context: ctx, min, max });
  if (!Array.isArray(data.steps)) throw new Error('Formato inesperado');
  return data.steps;
}

// ============================================================
//  TAREAS
// ============================================================
function makeTask(text) {
  return { id: newId(), text, done: false, children: [], loading: false };
}

const listEl  = document.getElementById('list');
const emptyEl = document.getElementById('empty');

function renderTasks() {
  const tasks = activeList().tasks;
  emptyEl.style.display = tasks.length ? 'none' : 'block';
  if (!tasks.length) { emptyEl.className = 'note'; emptyEl.textContent = 'Tus pasos aparecerán aquí. 🌶️'; }
  listEl.innerHTML = '';
  tasks.forEach((t, i) => listEl.appendChild(renderItem(t, tasks, i)));
}

// Propaga un estado de completado hacia abajo: la tarea y TODAS
// sus descendientes (hijas, nietas, etc.) toman el mismo valor.
function setDoneDeep(task, value) {
  task.done = value;
  if (task.children) task.children.forEach(c => setDoneDeep(c, value));
}

// Recalcula de abajo hacia arriba: una madre queda marcada solo si
// TODAS sus hijas lo están. Se corre sobre todo el árbol.
function recalcDone(task) {
  if (task.children && task.children.length) {
    task.children.forEach(recalcDone);
    task.done = task.children.every(c => c.done);
  }
}

// Mueve una tarea dentro de su grupo de hermanas (dir: -1 sube, +1 baja).
function moveItem(siblings, index, dir) {
  const j = index + dir;
  if (j < 0 || j >= siblings.length) return;
  [siblings[index], siblings[j]] = [siblings[j], siblings[index]];
  save();
  renderTasks();
}

function renderItem(task, siblings, index) {
  const li = document.createElement('li');
  li.className = 'item' + (task.done ? ' completed' : '');

  const row = document.createElement('div');
  row.className = 'item-row';

  const hasKids = task.children && task.children.length;

  // toggle de plegar/desplegar (ocupa espacio siempre, para alinear)
  const tog = document.createElement('button');
  tog.className = 'toggle';
  if (hasKids) {
    if (!task.collapsed) tog.classList.add('open');
    tog.textContent = '▸';
    tog.title = task.collapsed ? 'Mostrar subtareas' : 'Ocultar subtareas';
    tog.onclick = () => { task.collapsed = !task.collapsed; save(); renderTasks(); };
  } else {
    tog.classList.add('hidden');
    tog.disabled = true;
  }

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'check';
  cb.checked = task.done;
  cb.onchange = () => {
    setDoneDeep(task, cb.checked);              // hacia abajo: marca/desmarca todas sus subtareas
    activeList().tasks.forEach(recalcDone);     // hacia arriba: cada madre refleja a sus hijas
    save();
    renderTasks();
  };

  const lbl = document.createElement('div');
  lbl.className = 'label';
  lbl.textContent = task.text;

  // contador de subtareas completadas (solo si tiene hijas)
  let count = null;
  if (hasKids) {
    count = document.createElement('span');
    count.className = 'count';
    const done = task.children.filter(c => c.done).length;
    count.textContent = done + '/' + task.children.length;
  }

  const more = document.createElement('button');
  more.className = 'more';
  more.textContent = task.loading ? '…' : '🌶️ más';
  more.disabled = task.loading;
  more.onclick = async () => {
    task.loading = true; renderTasks();
    try {
      const subs = await breakDown(task.text);
      task.children = subs.map(makeTask);
      task.collapsed = false;            // al desglosar, mostramos las nuevas hijas
    } catch (e) {
      if (e.message !== 'No autorizado') alert('No se pudo desglosar: ' + e.message);
    }
    task.loading = false; save(); renderTasks();
  };

  // flechas para reordenar (solo entre hermanas)
  const move = document.createElement('div');
  move.className = 'move';
  const up = document.createElement('button');
  up.textContent = '▲';
  up.title = 'Subir';
  up.disabled = index === 0;
  up.onclick = () => moveItem(siblings, index, -1);
  const down = document.createElement('button');
  down.textContent = '▼';
  down.title = 'Bajar';
  down.disabled = index === siblings.length - 1;
  down.onclick = () => moveItem(siblings, index, 1);
  move.appendChild(up);
  move.appendChild(down);

  row.appendChild(tog);
  row.appendChild(cb);
  row.appendChild(lbl);
  if (count) row.appendChild(count);
  row.appendChild(move);
  row.appendChild(more);
  li.appendChild(row);

  // las hijas solo se dibujan si NO está plegada
  if (hasKids && !task.collapsed) {
    const ul = document.createElement('ul');
    ul.className = 'children';
    task.children.forEach((c, i) => ul.appendChild(renderItem(c, task.children, i)));
    li.appendChild(ul);
  }
  return li;
}

// ============================================================
//  BOTÓN PRINCIPAL "Desglosar"
// ============================================================
const goBtn = document.getElementById('go');
const taskInput = document.getElementById('task');

async function handleGo() {
  const text = taskInput.value.trim();
  if (!text) { taskInput.focus(); return; }

  goBtn.disabled = true;
  emptyEl.style.display = 'block';
  emptyEl.className = 'note';
  emptyEl.innerHTML = 'Picando la tarea<span class="dots"></span>';

  try {
    const subs = await breakDown(text);
    const parent = makeTask(text);          // la tarea que escribiste = madre
    parent.children = subs.map(makeTask);   // los pasos = subtareas
    activeList().tasks.push(parent);        // se agrega al final (no borra lo anterior)
    taskInput.value = '';
    save();
    renderTasks();
  } catch (e) {
    if (e.message !== 'No autorizado') alert('No se pudo desglosar: ' + e.message);
    renderTasks();                          // volver a mostrar lo que ya había
  } finally {
    goBtn.disabled = false;
  }
}
goBtn.onclick = handleGo;
taskInput.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleGo();
});

// ============================================================
//  REDIBUJAR TODO  +  ARRANQUE
// ============================================================
function renderAll() {
  renderLists();
  syncCtxPanel();
  renderTasks();
}

load();
renderPeppers();
renderAll();

// Si ya hay contraseña guardada, entramos directo. Si no, login.
// (Si la contraseña guardada estuviera mal, el primer desglose
//  devolvería 401 y te mandaría de vuelta al login automáticamente.)
if (getPass()) {
  hideLock();
} else {
  showLock('');
}
