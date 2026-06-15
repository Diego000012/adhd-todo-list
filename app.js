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
    initApp();                  // recién logueado → sincroniza con la nube
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
// Nivel de desglose para el botón "🌶️ más" (1=pocos pasos … 5=muchos).
const SPICE_RANGE = { 1: [2,3], 2: [3,4], 3: [4,6], 4: [6,8], 5: [8,12] };
let spice = 3;   // nivel fijo por defecto

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
  state.updatedAt = Date.now();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { /* en algunos entornos localStorage no está; no pasa nada */ }
  scheduleCloudSync();
}

// Cargar al arrancar: si no hay nada guardado, creamos una lista de ejemplo.
function load() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  if (saved) {
    try {
      state = JSON.parse(saved);
      // Migración: las listas viejas no tienen cajón de archivo. Se lo damos.
      state.lists.forEach(l => { if (!l.archived) l.archived = []; });
      return;
    } catch (e) {}
  }
  // Estado inicial por defecto
  state = {
    nextId: 1,
    activeId: 1,
    lists: [
      { id: 1, name: 'Trabajo', context: '', tasks: [], archived: [] },
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
    b.onclick = () => {
      if (l.id === state.activeId) {
        openListMenu(b);                       // ya activa → abre el menú
      } else {
        state.activeId = l.id; save(); renderAll();   // otra → la activa
      }
    };
    listsEl.appendChild(b);
  });
  // Chip para añadir una lista nueva
  const add = document.createElement('button');
  add.className = 'list-chip add';
  add.textContent = '+';
  add.onclick = () => {
    const name = prompt('Nombre de la nueva lista:', 'Nueva lista');
    if (name === null) return;
    const id = newId();
    state.lists.push({ id, name: name.trim() || 'Nueva lista', context: '', tasks: [], archived: [] });
    state.activeId = id;
    save(); renderAll();
  };
  listsEl.appendChild(add);
}

// ============================================================
//  MENÚ DE LA LISTA (renombrar / contexto / borrar)  +  MODAL
// ============================================================
const listMenu         = document.getElementById('listMenu');
const listMenuBackdrop = document.getElementById('listMenuBackdrop');
const nameInput        = document.getElementById('listName');
const deleteBtn        = document.getElementById('deleteList');
const editCtxBtn       = document.getElementById('editCtxBtn');

const ctxModal         = document.getElementById('ctxModal');
const ctxModalBackdrop = document.getElementById('ctxModalBackdrop');
const ctxInput         = document.getElementById('listCtx');
const ctxModalClose    = document.getElementById('ctxModalClose');

// Abrir el menú junto a la pestaña activa.
function openListMenu(chip) {
  nameInput.value = activeList().name || '';
  const r = chip.getBoundingClientRect();
  listMenu.style.top  = (r.bottom + 6) + 'px';
  listMenu.style.left = r.left + 'px';
  listMenu.classList.add('open');
  listMenuBackdrop.classList.add('open');
  nameInput.focus();
  nameInput.select();
}
function closeListMenu() {
  listMenu.classList.remove('open');
  listMenuBackdrop.classList.remove('open');
}

// Renombrar (se guarda al escribir).
nameInput.oninput = () => {
  activeList().name = nameInput.value;
  save();
  renderLists();
};

// Borrar lista.
deleteBtn.onclick = () => {
  if (state.lists.length <= 1) {
    alert('No puedes borrar la única lista. Crea otra primero.');
    return;
  }
  const l = activeList();
  if (!confirm(`¿Borrar la lista "${l.name}" y todas sus tareas?`)) return;
  state.lists = state.lists.filter(x => x.id !== l.id);
  state.activeId = state.lists[0].id;
  closeListMenu();
  save(); renderAll();
};

// Editar contexto → abre el modal.
editCtxBtn.onclick = () => {
  ctxInput.value = activeList().context || '';
  closeListMenu();
  ctxModal.classList.add('open');
  ctxModalBackdrop.classList.add('open');
  ctxInput.focus();
};
function closeCtxModal() {
  ctxModal.classList.remove('open');
  ctxModalBackdrop.classList.remove('open');
}
ctxInput.oninput = () => {
  activeList().context = ctxInput.value;
  save();
};
ctxModalClose.onclick = closeCtxModal;
ctxModalBackdrop.onclick = closeCtxModal;

// Cerrar con clic afuera o con Escape.
listMenuBackdrop.onclick = closeListMenu;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeListMenu(); closeCtxModal(); }
});

// ============================================================
//  LLAMADA AL WORKER  (ya NO a Anthropic directo)
// ============================================================
//  Le mandamos la tarea + el contexto de la lista activa.
//  El Worker arma el prompt, le pega la key y nos devuelve los pasos.
async function breakDown(text, ancestors = []) {
  const [min, max] = SPICE_RANGE[spice];
  const listCtx = (activeList().context || '').trim();

  // Contexto = el de la lista + la cadena jerárquica de tareas madre
  // (de la más general a la más específica), para que Claude no pierda
  // el hilo al desglosar subtareas profundas.
  let context = listCtx;
  if (ancestors.length) {
    let chain = 'Cadena de tareas, de la más general a la más específica. La tarea a desglosar pertenece a esta jerarquía:\n';
    ancestors.forEach((t, i) => { chain += '  '.repeat(i) + '- ' + t + '\n'; });
    context = (listCtx ? listCtx + '\n\n' : '') + chain.trimEnd();
  }

  const data = await callWorker({ task: text, context, min, max });
  if (!Array.isArray(data.steps)) throw new Error('Formato inesperado');
  return data.steps;
}

// ============================================================
//  TAREAS
// ============================================================
function makeTask(text) {
  return { id: newId(), text, done: false, children: [], loading: false, collapsed: false };
}

const listEl  = document.getElementById('list');
const emptyEl = document.getElementById('empty');

function renderTasks() {
  const tasks = activeList().tasks;
  emptyEl.style.display = tasks.length ? 'none' : 'block';
  if (!tasks.length) { emptyEl.className = 'note'; emptyEl.textContent = 'Tus pasos aparecerán aquí. 🌶️'; }
  listEl.innerHTML = '';
  tasks.forEach((t, i) => listEl.appendChild(renderItem(t, tasks, i, true, [])));
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
// Como solo intercambia dentro del mismo array, una subtarea nunca
// puede saltar a otro nivel: queda restringida a sus hermanas.
function moveItem(siblings, index, dir) {
  const j = index + dir;
  if (j < 0 || j >= siblings.length) return;
  [siblings[index], siblings[j]] = [siblings[j], siblings[index]];
  save();
  renderTasks();
}

function renderItem(task, siblings, index, isRoot, trail) {
  const li = document.createElement('li');
  li.className = 'item' + (task.done ? ' completed' : '');

  const row = document.createElement('div');
  row.className = 'item-row';

  const hasKids = task.children && task.children.length;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'check';
  cb.checked = task.done;
  
  // Color del checkbox según la prioridad (gris si no tiene).
  const prio = task.priority || 'no-priority';
  if (prio !== 'no-priority') {
    cb.style.setProperty('--prio', priorityColors[prio]);
  }
  cb.onchange = () => {
    setDoneDeep(task, cb.checked);              // hacia abajo: marca/desmarca todas sus subtareas
    activeList().tasks.forEach(recalcDone);     // hacia arriba: cada madre refleja a sus hijas
    save();
    renderTasks();
  };

  const lbl = document.createElement('div');
  lbl.className = 'label';
  lbl.textContent = task.text;
  // Si tiene subtareas, el texto funciona como toggle de plegar/desplegar.
  if (hasKids) {
    lbl.classList.add('clickable');
    lbl.title = task.collapsed ? 'Expandir' : 'Contraer';
    lbl.onclick = () => { task.collapsed = !task.collapsed; save(); renderTasks(); };
  }

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
  more.disabled = task.loading;

  // Íconos SVG: el de "cargando" (tres puntos) o el de "desglosar" (círculo +)
  const ICON_LOADING = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M17 12h.01"/><path d="M12 12h.01"/><path d="M7 12h.01"/></svg>`;
  const ICON_BREAKDOWN = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 0 1 7.38 16.75"/><path d="M12 8v8"/><path d="M16 12H8"/><path d="M2.5 8.875a10 10 0 0 0-.5 3"/><path d="M2.83 16a10 10 0 0 0 2.43 3.4"/><path d="M4.636 5.235a10 10 0 0 1 .891-.857"/><path d="M8.644 21.42a10 10 0 0 0 7.631-.38"/></svg>`;
  more.innerHTML = task.loading ? ICON_LOADING : ICON_BREAKDOWN;
  more.onclick = async () => {
    task.loading = true; renderTasks();
    try {
      const subs = await breakDown(task.text, trail);
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

  row.appendChild(cb);
  row.appendChild(lbl);

  // Indicador de notas (solo visual, si la tarea tiene descripción)
  if (task.notes && task.notes.trim()) {
    const noteIcon = document.createElement('span');
    noteIcon.className = 'note-indicator';
    noteIcon.title = 'Tiene notas';
    noteIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M12 2v4"/><path d="M16 2v4"/><rect width="16" height="18" x="4" y="4" rx="2"/><path d="M8 10h6"/><path d="M8 14h8"/><path d="M8 18h5"/></svg>`;
    row.appendChild(noteIcon);
  }

  if (count) row.appendChild(count);
  row.appendChild(move);

  // En una tarea RAÍZ completa, "Archivar" reemplaza a "🌶️ más".
  // En el resto de casos, se muestra "🌶️ más" como siempre.
  if (isRoot && task.done) {
    const arch = document.createElement('button');
    arch.className = 'archive-task-btn';
    arch.textContent = 'Archivar';
    arch.onclick = () => archiveTask(task);
    row.appendChild(arch);
  } else {
    row.appendChild(more);
  }

  // Botón ⋮ — abre el canvas de la tarea (en todas las tareas)
  const dots = document.createElement('button');
  dots.className = 'dots-btn';
  dots.title = 'Abrir';
  dots.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;
  dots.onclick = () => openCanvas(task);
  row.appendChild(dots);

  li.appendChild(row);

  // las hijas solo se dibujan si NO está plegada (y nunca son raíz)
  if (hasKids && !task.collapsed) {
    const ul = document.createElement('ul');
    ul.className = 'children';
    task.children.forEach((c, i) => ul.appendChild(renderItem(c, task.children, i, false, [...trail, task.text])));
    li.appendChild(ul);
  }
  return li;
}

// ============================================================
//  BOTÓN PRINCIPAL "Desglosar"
// ============================================================
const goBtn = document.getElementById('go');
const taskInput = document.getElementById('task');

// ============================================================
//  SELECTOR DE PRIORIDAD
// ============================================================
const priorityBtn = document.getElementById('priorityBtn');
const priorityMenu = document.getElementById('priorityMenu');
const priorityOptions = priorityMenu.querySelectorAll('.priority-option');

let currentPriority = 'no-priority';

const priorityColors = {
  'no-priority': '#757575',
  'low': '#60ABEB',
  'medium': '#FFC95E',
  'high': '#F77363'
};

// Pinta la bandera según la prioridad actual.
function applyPriorityToBtn() {
  if (currentPriority === 'no-priority') {
    priorityBtn.style.background = '';   // sin fondo → cae al CSS (gris/hover)
    priorityBtn.style.color = '';        // bandera gris (del CSS)
    priorityBtn.classList.remove('has-prio');
  } else {
    priorityBtn.style.background = priorityColors[currentPriority];  // fondo de color
    priorityBtn.style.color = '#fff';                                // bandera blanca
    priorityBtn.classList.add('has-prio');
  }
}

// Abrir/cerrar menú
priorityBtn.onclick = (e) => {
  e.stopPropagation();
  priorityMenu.classList.toggle('active');
  priorityBtn.classList.toggle('active', priorityMenu.classList.contains('active'));
};

// Cerrar menú cuando se hace click fuera
document.addEventListener('click', (e) => {
  if (!e.target.closest('.priority-selector')) {
    priorityMenu.classList.remove('active');
    priorityBtn.classList.remove('active');
  }
});

// Seleccionar prioridad
priorityOptions.forEach(option => {
  option.onclick = (e) => {
    e.stopPropagation();
    currentPriority = option.dataset.priority;
    applyPriorityToBtn();
    priorityMenu.classList.remove('active');
    priorityBtn.classList.remove('active');
  };
});

// Estado inicial del botón
applyPriorityToBtn();

function handleGo() {
  const text = taskInput.value.trim();
  if (!text) { taskInput.focus(); return; }

  const task = makeTask(text);
  task.priority = currentPriority;
  activeList().tasks.unshift(task);   // tarea suelta, al inicio
  taskInput.value = '';
  autoGrow();                                   // devuelve el cajón a su altura mínima
  currentPriority = 'no-priority';  // resetear prioridad
  applyPriorityToBtn();
  save();
  renderTasks();
}

goBtn.onclick = handleGo;
taskInput.addEventListener('keydown', e => {
  // Enter crea la tarea. Shift+Enter (o Cmd/Ctrl+Enter) hace salto de línea.
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();   // evita que se inserte el salto de línea
    handleGo();
  }
});

// Ajusta la altura del cajón a su contenido (hasta el tope del CSS).
function autoGrow() {
  taskInput.style.height = 'auto';                 // reinicia para medir bien
  taskInput.style.height = taskInput.scrollHeight + 'px';
}
taskInput.addEventListener('input', autoGrow);

// ============================================================
//  ARCHIVO
// ============================================================
const archiveBtn      = document.getElementById('archiveBtn');
const archivePanel    = document.getElementById('archivePanel');
const archiveBackdrop = document.getElementById('archiveBackdrop');
const archiveClose    = document.getElementById('archiveClose');
const archiveListEl   = document.getElementById('archiveList');
const archiveEmptyEl  = document.getElementById('archiveEmpty');

// Archivar una tarea raíz: sale de la lista activa y entra al archivo.
function archiveTask(task) {
  const list = activeList();
  list.tasks = list.tasks.filter(t => t.id !== task.id);
  list.archived.push(task);
  save();
  renderTasks();
  renderArchive();
  pulseArchive();   // avisa con un destello que algo entró al archivo
}

// Desarchivar: vuelve a la lista activa, desmarcada (ella y sus subtareas).
function unarchive(task) {
  const list = activeList();
  list.archived = list.archived.filter(t => t.id !== task.id);
  setDoneDeep(task, false);
  list.tasks.push(task);
  save();
  renderTasks();
  renderArchive();
}

// Destello del botón flotante.
function pulseArchive() {
  archiveBtn.classList.remove('pulse');
  void archiveBtn.offsetWidth;        // truco para reiniciar la animación
  archiveBtn.classList.add('pulse');
}

// Dibujar el contenido del panel (archivadas de la lista activa).
function renderArchive() {
  const archived = activeList().archived || [];
  archiveEmptyEl.style.display = archived.length ? 'none' : 'block';
  archiveListEl.innerHTML = '';
  archived.forEach(task => {
    const li = document.createElement('li');
    li.className = 'archive-item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'check';
    cb.checked = true;
    cb.title = 'Devolver a la lista';
    cb.onchange = () => unarchive(task);

    const lbl = document.createElement('span');
    lbl.className = 'archive-label';
    lbl.textContent = task.text;

    li.appendChild(cb);
    li.appendChild(lbl);
    archiveListEl.appendChild(li);
  });
}

function openArchive() {
  closeCanvas();                        // cierra el canvas si estaba abierto
  renderArchive();
  archivePanel.classList.add('open');
  archiveBackdrop.classList.add('open');
}
function closeArchive() {
  archivePanel.classList.remove('open');
  archiveBackdrop.classList.remove('open');
}
archiveBtn.onclick = openArchive;
archiveClose.onclick = closeArchive;
archiveBackdrop.onclick = closeArchive;

// ============================================================
//  CANVAS DE TAREA
// ============================================================
const canvasPanel    = document.getElementById('canvasPanel');
const canvasBackdrop = document.getElementById('canvasBackdrop');
const canvasTitle    = document.getElementById('canvasTitle');
const canvasCheck    = document.getElementById('canvasCheck');
const canvasDate     = document.getElementById('canvasDate');
const canvasDateText = document.getElementById('canvasDateText');
const canvasPrio     = document.getElementById('canvasPrio');
let canvasTask = null;   // recuerda qué tarea está abierta

const PRIORITY_LABELS = {
  'no-priority': 'Sin prioridad', 'low': 'Low', 'medium': 'Medium', 'high': 'High'
};

const canvasDateInput = document.getElementById('canvasDateInput');
const canvasDateClear = document.getElementById('canvasDateClear');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
// Formatea 'YYYY-MM-DD' → 'Jun 1, 2026' (sin líos de zona horaria).
function formatDue(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return MONTHS[m-1] + ' ' + d + ', ' + y;
}

function openCanvas(task) {
  canvasTask = task;
  canvasTitle.value = task.text;
  growCanvasTitle();
  renderCanvas();
  closeArchive();
  canvasPanel.classList.add('open');
  canvasBackdrop.classList.add('open');
}

// Ajusta la altura del título a su contenido (crece si es largo).
function growCanvasTitle() {
  canvasTitle.style.height = 'auto';
  canvasTitle.style.height = canvasTitle.scrollHeight + 'px';
}

// Editar el título: se guarda al instante y se refleja en la lista.
canvasTitle.addEventListener('input', () => {
  if (!canvasTask) return;
  canvasTask.text = canvasTitle.value;
  growCanvasTitle();
  save();
  renderTasks();
});

function closeCanvas() {
  canvasPanel.classList.remove('open');
  canvasBackdrop.classList.remove('open');
  canvasTask = null;
}
canvasBackdrop.onclick = closeCanvas;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCanvas(); });

// Dibuja el contenido del canvas según la tarea abierta.
function renderCanvas() {
  if (!canvasTask) return;

  // Checkbox (con el color de la prioridad)
  canvasCheck.checked = canvasTask.done;
  const prio = canvasTask.priority || 'no-priority';
  if (prio !== 'no-priority') canvasCheck.style.setProperty('--prio', priorityColors[prio]);
  else canvasCheck.style.removeProperty('--prio');

  // Chip de prioridad
  canvasPrio.textContent = PRIORITY_LABELS[prio];
  canvasPrio.style.background = (prio === 'no-priority') ? 'var(--muted)' : priorityColors[prio];

// Mantener el input nativo en sintonía con la fecha guardada
  canvasDateInput.value = canvasTask.dueDate || '';

  // Fecha
  if (canvasTask.dueDate) {
    canvasDateText.textContent = formatDue(canvasTask.dueDate);
    canvasDateClear.style.display = '';
  } else {
    canvasDateText.textContent = 'Sin fecha';
    canvasDateClear.style.display = 'none';
  }

// Notas
  canvasNotes.value = canvasTask.notes || '';
  growNotes();

}

// --- Prioridad editable desde el canvas ---
const canvasPrioMenu = document.getElementById('canvasPrioMenu');

canvasPrio.onclick = (e) => {
  e.stopPropagation();
  canvasPrioMenu.classList.toggle('active');
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('.canvas-prio-wrap')) {
    canvasPrioMenu.classList.remove('active');
  }
});
canvasPrioMenu.querySelectorAll('.priority-option').forEach(option => {
  option.onclick = (e) => {
    e.stopPropagation();
    if (!canvasTask) return;
    canvasTask.priority = option.dataset.priority;
    save();
    renderCanvas();    // actualiza el chip y el checkbox del canvas
    renderTasks();     // actualiza el color del checkbox en la lista
    canvasPrioMenu.classList.remove('active');
  };
});

// Completar la tarea desde el canvas (misma lógica que en la lista).
canvasCheck.onchange = () => {
  if (!canvasTask) return;
  setDoneDeep(canvasTask, canvasCheck.checked);
  activeList().tasks.forEach(recalcDone);
  save();
  renderTasks();
  renderCanvas();
};

// Abrir el calendario al hacer clic en el chip de fecha.
canvasDate.onclick = () => {
  if (!canvasTask) return;
  canvasDateInput.value = canvasTask.dueDate || '';
  try {
    canvasDateInput.showPicker();
  } catch (err) {
    canvasDateInput.click();
  }
};
// Al elegir una fecha, se guarda y se muestra.
canvasDateInput.onchange = () => {
  if (!canvasTask) return;
  canvasTask.dueDate = canvasDateInput.value || null;   // 'YYYY-MM-DD' o null
  save();
  renderCanvas();
};
// Quitar la fecha.
canvasDateClear.onclick = (e) => {
  e.stopPropagation();
  if (!canvasTask) return;
  canvasTask.dueDate = null;
  save();
  renderCanvas();
};

const canvasNotes = document.getElementById('canvasNotes');

// Crece con el contenido hasta 200px; de ahí, scroll.
function growNotes() {
  canvasNotes.style.height = 'auto';
  canvasNotes.style.height = Math.min(canvasNotes.scrollHeight, 400) + 'px';
}

// Editar notas: se guarda al instante.
canvasNotes.addEventListener('input', () => {
  if (!canvasTask) return;
  canvasTask.notes = canvasNotes.value;
  growNotes();
  save();
  renderTasks();
});

// ============================================================
//  ELIMINAR TAREA (desde el canvas) + confirmación + píldora
// ============================================================
const canvasDelete   = document.getElementById('canvasDelete');
const confirmBackdrop = document.getElementById('confirmBackdrop');
const confirmModal   = document.getElementById('confirmModal');
const confirmCancel  = document.getElementById('confirmCancel');
const confirmDelete  = document.getElementById('confirmDelete');
const toastEl        = document.getElementById('toast');

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function openConfirm()  { confirmModal.classList.add('open');  confirmBackdrop.classList.add('open'); }
function closeConfirm() { confirmModal.classList.remove('open'); confirmBackdrop.classList.remove('open'); }

// Elimina una tarea esté donde esté en el árbol (raíz o anidada).
function deleteTaskById(task) {
  const removeFrom = (arr) => {
    const i = arr.findIndex(t => t.id === task.id);
    if (i !== -1) { arr.splice(i, 1); return true; }
    return arr.some(t => t.children && removeFrom(t.children));
  };
  removeFrom(activeList().tasks);
  activeList().tasks.forEach(recalcDone);   // por si cambia el estado de alguna madre
}

canvasDelete.onclick = () => { if (canvasTask) openConfirm(); };
confirmCancel.onclick = closeConfirm;
confirmBackdrop.onclick = closeConfirm;
confirmDelete.onclick = () => {
  if (!canvasTask) return;
  deleteTaskById(canvasTask);
  closeConfirm();
  closeCanvas();
  save();
  renderTasks();
  showToast('Tarea eliminada');
};

// ============================================================
//  REDIBUJAR TODO  +  ARRANQUE
// ============================================================
function renderAll() {
  renderLists();
  renderTasks();
  renderArchive();
}

// ============================================================
//  SINCRONIZACIÓN CON LA NUBE (Cloudflare KV)
// ============================================================
const syncStatusEl = document.getElementById('syncStatus');
const syncBtn      = document.getElementById('syncBtn');
let syncTimer = null;

function setSyncStatus(s) {
  const map = {
    loading: 'Cargando…',
    pending: 'Cambios sin guardar',
    saving:  'Guardando…',
    saved:   'Sincronizado',
    error:   'Sin conexión'
  };
  if (syncStatusEl) syncStatusEl.textContent = map[s] || '';
}

// Lee los datos de la nube (objeto o null si nunca se guardó).
async function cloudLoad() {
  const res = await callWorker({ action: 'load' });
  return res.data;
}

// Sube el estado actual a la nube.
async function cloudSave() {
  setSyncStatus('saving');
  try {
    await callWorker({ action: 'save', data: state });
    setSyncStatus('saved');
  } catch (e) {
    setSyncStatus('error');
  }
}

// Sincronización completa: baja lo más reciente, o sube lo local si es más nuevo.
async function fullSync() {
  const cloud = await cloudLoad();
  if (cloud && (cloud.updatedAt || 0) > (state.updatedAt || 0)) {
    state = cloud;                                   // nube más nueva → bajar
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
    renderAll();
  } else {
    await callWorker({ action: 'save', data: state });   // local más nuevo → subir
  }
}

// Respaldo automático con "respiro" de 10s: cada cambio reinicia el reloj.
function scheduleCloudSync() {
  setSyncStatus('pending');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(cloudSave, 10000);
}

// Al abrir (ya autenticado): compara nube vs local y usa lo más reciente.
async function initApp() {
  setSyncStatus('loading');
  try {
    const cloud = await cloudLoad();
    if (cloud && (cloud.updatedAt || 0) > (state.updatedAt || 0)) {
      state = cloud;                                   // la nube es más nueva → la adoptamos
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
      renderAll();
      setSyncStatus('saved');
    } else if (!cloud) {
      cloudSave();                                     // nube vacía → subimos lo local
    } else {
      setSyncStatus('saved');                          // local es igual o más nuevo
    }
  } catch (e) {
    setSyncStatus('error');
  }
}

// Íconos del botón de sincronizar
const ICON_SYNC = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`;
const ICON_SYNCED = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 15-5.5 5.5L9 18"/><path d="M5.516 16.07A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 3.501 7.327"/></svg>`;
let syncedTimer = null;

async function doSync() {
  clearTimeout(syncedTimer);
  syncBtn.classList.remove('synced');
  syncBtn.innerHTML = ICON_SYNC;
  syncBtn.classList.add('spinning');         // empieza a girar
  try {
    await fullSync();
    syncBtn.classList.remove('spinning');
    syncBtn.innerHTML = ICON_SYNCED;          // muestra el check
    syncBtn.classList.add('synced');
    syncedTimer = setTimeout(() => {          // a los 5s vuelve al ícono normal
      syncBtn.innerHTML = ICON_SYNC;
      syncBtn.classList.remove('synced');
    }, 5000);
  } catch (e) {
    syncBtn.classList.remove('spinning');
    syncBtn.innerHTML = ICON_SYNC;            // si falla, vuelve al ícono normal
  }
}
syncBtn.onclick = () => { clearTimeout(syncTimer); doSync(); };

load();
renderAll();

// Si ya hay contraseña guardada, entramos directo. Si no, login.
// (Si la contraseña guardada estuviera mal, el primer desglose
//  devolvería 401 y te mandaría de vuelta al login automáticamente.)
if (getPass()) {
  hideLock();
  initApp(); 
} else {
  showLock('');
}
