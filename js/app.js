/*
 * Funciones globales para SettleMe con backend.
 * Este script gestiona el tema, realiza solicitudes al servidor
 * para registrar usuarios, iniciar sesión, gestionar horarios,
 * recibos y grupos.  Las funciones devuelven promesas y se
 * utilizan en los scripts incrustados en cada página HTML.
 */

// URL base para las peticiones API.  Como los archivos se sirven desde
// el mismo servidor, se puede dejar vacío.  Modifíquelo si despliega
// el backend en otra dirección.
const API_BASE = '';

// Inicializa el tema (claro u oscuro) según la preferencia almacenada
function initTheme() {
  const theme = localStorage.getItem('theme') || 'light';
  if (theme === 'dark') {
    document.body.classList.add('dark-mode');
  }
}

// Alternar tema y guardar preferencia
function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// Convierte archivo a cadena base64
function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Formato de fecha y hora
function formatDateTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

// Calcula número de horas entre dos fechas ISO
function calcHours(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return (end - start) / (1000 * 60 * 60);
}

// Escapa valores para CSV
function escapeCsv(value) {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Descarga contenido CSV como archivo
function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Registro de usuario via API
async function registerUser(userData) {
  const res = await fetch(API_BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData)
  });
  return await res.json();
}

// Iniciar sesión via API.  Almacena id y rol si es exitoso.
async function login(email, password) {
  const res = await fetch(API_BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (data.success) {
    localStorage.setItem('currentUserId', data.user.id);
    localStorage.setItem('currentUserRole', data.user.role);
  }
  return data;
}

// Cierra sesión limpiando almacenamiento local
function logout() {
  localStorage.removeItem('currentUserId');
  localStorage.removeItem('currentUserRole');
}

/*
 * Configuración de seguridad: temporizador de inactividad
 * Se define una configuración global window.securitySettings con el parámetro inactivityMinutes.
 * setupInactivityTimer() añade escuchas a eventos de interacción para reiniciar el temporizador.
 * resetInactivityTimer() reinicia el temporizador según la configuración actual y cierra la sesión al expirar.
 */

// Configuración global por defecto de seguridad
if (!window.securitySettings) {
  window.securitySettings = { inactivityMinutes: 1 };
}

// Temporizador de inactividad
let _inactivityTimer;

// Reinicia el temporizador de inactividad
window.resetInactivityTimer = function () {
  // Si no se definió minutes, utilizar 1
  const minutes = (window.securitySettings && window.securitySettings.inactivityMinutes) || 1;
  const timeoutMs = minutes * 60 * 1000;
  if (_inactivityTimer) {
    clearTimeout(_inactivityTimer);
  }
  _inactivityTimer = setTimeout(() => {
    // Cerrar la sesión tras la inactividad
    alert('Sesión cerrada por inactividad');
    logout();
    // Redirigir a la página de inicio
    window.location.href = 'index.html';
  }, timeoutMs);
};

// Configura escuchas globales para reiniciar el temporizador en actividad
window.setupInactivityTimer = function () {
  if (window._inactivityListener) {
    // Ya se configuraron los escuchas
    window.resetInactivityTimer();
    return;
  }
  const resetHandler = () => {
    window.resetInactivityTimer();
  };
  ['click', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach((evt) => {
    document.addEventListener(evt, resetHandler);
  });
  // Marcar que los escuchas ya están registrados
  window._inactivityListener = true;
  // Lanzar el temporizador inicial
  window.resetInactivityTimer();
};

// Devuelve ID del usuario autenticado
function getCurrentUserId() {
  return localStorage.getItem('currentUserId');
}

// Obtiene usuario completo por ID
async function fetchUser(id) {
  const res = await fetch(API_BASE + '/api/users/' + id);
  return await res.json();
}

// Obtiene usuario actual o null
async function getCurrentUser() {
  const id = getCurrentUserId();
  if (!id) return null;
  return await fetchUser(id);
}

// Lista todos los usuarios (para admin)
async function getUsers() {
  const res = await fetch(API_BASE + '/api/users');
  return await res.json();
}

// Alterna clock in/out en el servidor
async function toggleClock() {
  const id = getCurrentUserId();
  if (!id) return;
  await fetch(API_BASE + '/api/users/' + id + '/clock', { method: 'POST' });
  await updateTimeTable();
  await updateClockButton();
}

// Alterna clock in/out para un usuario específico (usado por admin)
async function toggleClockForUser(userId) {
  if (!userId) return;
  await fetch(API_BASE + '/api/users/' + userId + '/clock', { method: 'POST' });
}

// Actualiza tabla de horarios para usuario actual
async function updateTimeTable() {
  const id = getCurrentUserId();
  if (!id) return;
  const res = await fetch(API_BASE + '/api/users/' + id + '/times');
  const times = await res.json();
  // Guardar global para updateClockButton
  window.currentTimes = times;
  const tbody = document.querySelector('#timesTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  times.forEach(record => {
    const tr = document.createElement('tr');
    const tdIn = document.createElement('td');
    const tdOut = document.createElement('td');
    const tdHours = document.createElement('td');
    tdIn.textContent = formatDateTime(record.clockIn);
    tdOut.textContent = record.clockOut ? formatDateTime(record.clockOut) : '—';
    tdHours.textContent = record.clockOut ? calcHours(record.clockIn, record.clockOut).toFixed(2) : '—';
    tr.appendChild(tdIn);
    tr.appendChild(tdOut);
    tr.appendChild(tdHours);
    tbody.appendChild(tr);
  });
}

// Actualiza el texto del botón de reloj según estado
async function updateClockButton() {
  const btn = document.getElementById('clockButton');
  if (!btn) return;
  const times = window.currentTimes;
  if (!times || times.length === 0) {
    btn.textContent = 'Iniciar jornada';
    return;
  }
  const last = times[times.length - 1];
  btn.textContent = last.clockOut ? 'Iniciar jornada' : 'Finalizar jornada';
}

// Añade recibo para usuario
// Añade recibo con categoría, monto, imagen y nota
async function addReceipt(userId, category, amount, imageData, note) {
  await fetch(API_BASE + '/api/users/' + userId + '/receipts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, amount, imageData, note })
  });
}

// Actualiza tabla de recibos para usuario actual
async function updateReceiptsTable() {
  const id = getCurrentUserId();
  if (!id) return;
  const res = await fetch(API_BASE + '/api/users/' + id + '/receipts');
  const receipts = await res.json();
  const tbody = document.querySelector('#receiptsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  receipts.forEach(r => {
    const tr = document.createElement('tr');
    const tdDate = document.createElement('td');
    tdDate.textContent = formatDateTime(r.date);
    const tdCat = document.createElement('td');
    tdCat.textContent = r.category;
    // Monto del recibo
    const tdAmt = document.createElement('td');
    tdAmt.textContent = r.amount !== null && r.amount !== undefined ? r.amount.toFixed(2) : '—';
    const tdNote = document.createElement('td');
    tdNote.textContent = r.note || '';
    const tdView = document.createElement('td');
    const viewLink = document.createElement('a');
    viewLink.className = 'action-link';
    viewLink.textContent = 'Ver';
    viewLink.href = '#';
    viewLink.onclick = (e) => {
      e.preventDefault();
      showModal(r.imageData, r.note);
    };
    tdView.appendChild(viewLink);
    tr.appendChild(tdDate);
    tr.appendChild(tdCat);
    tr.appendChild(tdAmt);
    tr.appendChild(tdNote);
    tr.appendChild(tdView);
    tbody.appendChild(tr);
  });
}

// Muestra modal para ver recibo
function showModal(imageData, note) {
  const modal = document.getElementById('modal');
  if (!modal) return;
  document.getElementById('modalImage').src = imageData;
  document.getElementById('modalNote').textContent = note || '';
  modal.style.display = 'flex';
}

// Cierra modal
function closeModal() {
  const modal = document.getElementById('modal');
  if (modal) modal.style.display = 'none';
}

// Gestión de grupos
async function getGroups() {
  const res = await fetch(API_BASE + '/api/groups');
  return await res.json();
}

async function createGroup(name) {
  const res = await fetch(API_BASE + '/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  return await res.json();
}

async function getGroupById(id) {
  const res = await fetch(API_BASE + '/api/groups/' + id);
  return await res.json();
}

async function addUserToGroup(groupId, userId) {
  const res = await fetch(API_BASE + '/api/groups/' + groupId + '/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  return await res.json();
}

async function removeUserFromGroup(groupId, userId) {
  await fetch(API_BASE + '/api/groups/' + groupId + '/users/' + userId, {
    method: 'DELETE'
  });
}

// Actualiza la información de pago de un usuario (tipo y tarifa)
async function updateUserPay(userId, payType, payRate) {
  if (!userId) return;
  await fetch(API_BASE + '/api/users/' + userId + '/pay', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payType, payRate })
  });
}

async function deleteGroup(id) {
  await fetch(API_BASE + '/api/groups/' + id, {
    method: 'DELETE'
  });
}

// Actualiza la contraseña del usuario. Requiere la contraseña actual y la nueva contraseña.
async function updateUserPassword(userId, oldPassword, newPassword) {
  const res = await fetch(API_BASE + '/api/users/' + userId + '/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword, newPassword })
  });
  return await res.json();
}

// Elimina la cuenta del usuario. Requiere confirmar el correo electrónico.
async function deleteUserAccount(userId, email) {
  const res = await fetch(API_BASE + '/api/users/' + userId, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  return await res.json();
}

async function getGroupsOfUser(userId) {
  const groups = await getGroups();
  return groups.filter(g => (g.members || []).includes(userId));
}

// Exportaciones: asignamos descarga directa apuntando a endpoints
function exportTimesCSV(userId) {
  window.location.href = API_BASE + '/api/exports/user/' + userId + '/times';
}
function exportReceiptsCSV(userId) {
  window.location.href = API_BASE + '/api/exports/user/' + userId + '/receipts';
}
function exportGroupTimesCSV(groupId) {
  window.location.href = API_BASE + '/api/exports/group/' + groupId + '/times';
}
function exportGroupReceiptsCSV(groupId) {
  window.location.href = API_BASE + '/api/exports/group/' + groupId + '/receipts';
}

// Exportación en PDF para usuarios y grupos
function exportTimesPDF(userId) {
  window.location.href = API_BASE + '/api/exports/user/' + userId + '/times/pdf';
}
function exportReceiptsPDF(userId) {
  window.location.href = API_BASE + '/api/exports/user/' + userId + '/receipts/pdf';
}
function exportGroupTimesPDF(groupId) {
  window.location.href = API_BASE + '/api/exports/group/' + groupId + '/times/pdf';
}
function exportGroupReceiptsPDF(groupId) {
  window.location.href = API_BASE + '/api/exports/group/' + groupId + '/receipts/pdf';
}

// Añade una fecha programada (schedule) para un usuario específico
async function addSchedule(userId, dateStr) {
  if (!userId || !dateStr) return;
  await fetch(API_BASE + '/api/users/' + userId + '/schedules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: dateStr })
  });
}

// Elimina una fecha programada para un usuario específico
async function removeSchedule(userId, dateStr) {
  if (!userId || !dateStr) return;
  await fetch(API_BASE + '/api/users/' + userId + '/schedules', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: dateStr })
  });
}

// Obtiene el logo de la compañía en base64 (devuelve null si no existe)
async function getCompanyLogo() {
  const res = await fetch(API_BASE + '/api/company/logo');
  const data = await res.json();
  return data.logo || null;
}

// Actualiza el logo de la compañía
async function updateCompanyLogo(logoData) {
  const res = await fetch(API_BASE + '/api/company/logo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logoData })
  });
  return await res.json();
}