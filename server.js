/*
 * Servidor HTTP sencillo para SettleMe.
 * Proporciona endpoints REST para registrar usuarios, iniciar sesión,
 * registrar horarios, subir recibos y gestionar grupos.  También sirve
 * los archivos estáticos que componen la interfaz de usuario.
 *
 * Uso: ejecutar `node server.js` en el directorio raíz de la aplicación
 * (donde se encuentra este archivo).  El servidor escucha en el puerto
 * especificado por la variable de entorno PORT o por defecto en 3000.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = __dirname;

// Lee el archivo de datos. Si no existe, devuelve estructura vacía.
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return { users: [], groups: [] };
  }
}

// Guarda el archivo de datos.
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Genera un PDF simple a partir de un título, cabeceras y filas.
// Devuelve un Buffer con el contenido del PDF en formato binario.
function generatePDF(title, headers, rows) {
  // Escapa caracteres especiales para PDF
  function escapeText(text) {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }
  // Calcula anchos máximos de columna basado en headers y filas
  const maxLengths = headers.map((header, i) => {
    let max = header.length;
    for (const row of rows) {
      const cell = row[i] != null ? String(row[i]) : '';
      if (cell.length > max) max = cell.length;
    }
    return max;
  });
  // Construye las líneas de texto con padding para alinear columnas
  const lines = [];
  // Título
  lines.push(title);
  // Cabeceras
  const headerLine = headers
    .map((text, i) => {
      const cell = text != null ? String(text) : '';
      return cell.padEnd(maxLengths[i] + 2);
    })
    .join('');
  lines.push(headerLine);
  // Filas de datos
  rows.forEach(row => {
    const line = row
      .map((cell, i) => {
        const value = cell != null ? String(cell) : '';
        return value.padEnd(maxLengths[i] + 2);
      })
      .join('');
    lines.push(line);
  });
  // Construye contenido PDF con fuente monoespaciada Courier
  let content = 'BT\n/F1 11 Tf\n';
  // Posición inicial vertical (arriba de la página)
  let y = 770;
  for (const line of lines) {
    content += `72 ${y} Td (${escapeText(line)}) Tj\n`;
    y -= 14;
    // Si se alcanza el borde inferior de la página, se puede ignorar (no soportamos múltiples páginas)
  }
  content += 'ET\n';
  const contentBuffer = Buffer.from(content, 'utf8');
  const len = contentBuffer.length;
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  function addObject(str) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += str;
  }
  // Catálogo
  addObject('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  // Páginas
  addObject('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  // Página
  addObject('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n');
  // Contenido
  addObject(`4 0 obj\n<< /Length ${len} >>\nstream\n${content}endstream\nendobj\n`);
  // Fuente Courier monoespaciada
  addObject('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n');
  // Tabla de referencias cruzadas
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += offset.toString().padStart(10, '0') + ' 00000 n \n';
  }
  // Trailer
  pdf += 'trailer\n<< /Size 6 /Root 1 0 R >>\n';
  pdf += 'startxref\n' + xrefOffset + '\n%%EOF';
  return Buffer.from(pdf, 'utf8');
}

// Utilidad para enviar respuesta JSON
function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Utilidad para parsear cuerpo JSON
function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      if (body) {
        try {
          const json = JSON.parse(body);
          resolve(json);
        } catch (err) {
          reject(new Error('Invalid JSON'));
        }
      } else {
        resolve({});
      }
    });
  });
}

// Crea el servidor
const server = http.createServer(async (req, res) => {
  // CORS headers para permitir solicitudes desde cualquier origen
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];
  const method = req.method;

  // Rutas API
  if (url.startsWith('/api/')) {
    const parts = url.split('/').filter(Boolean); // elimina cadenas vacías
    // parts[0] = 'api'
    try {
      // Cargar datos a memoria
      const data = readData();

    // Ruta para el logo de la compañía
    // GET /api/company/logo -> devuelve el logo en base64 (o null)
    // PUT /api/company/logo -> actualiza el logo (debe enviar { logoData: "data:image/..." })
    if (parts[1] === 'company' && parts[2] === 'logo') {
      if (method === 'GET') {
        sendJSON(res, 200, { logo: data.companyLogo || null });
        return;
      }
      if (method === 'PUT' || method === 'POST') {
        const body = await parseRequestBody(req);
        const logoData = body.logoData;
        if (!logoData) {
          sendJSON(res, 400, { success: false, message: 'logoData requerido' });
          return;
        }
        data.companyLogo = logoData;
        writeData(data);
        sendJSON(res, 200, { success: true });
        return;
      }
    }
      // /api/register
      if (method === 'POST' && parts[1] === 'register') {
        const body = await parseRequestBody(req);
        // Validaciones mínimas
        const { email, password, firstName, lastName } = body;
        if (!email || !password || !firstName || !lastName) {
          sendJSON(res, 400, { success: false, message: 'Campos obligatorios faltantes' });
          return;
        }
        // Verificar email único
        if (data.users.some(u => u.email === email)) {
          sendJSON(res, 400, { success: false, message: 'El correo ya está registrado' });
          return;
        }
        const newUser = {
          id: 'usr_' + Math.random().toString(36).substr(2, 9),
          firstName: body.firstName,
          middleName: body.middleName || '',
          lastName: body.lastName,
          phone: body.phone || '',
          email: email.toLowerCase(),
          password: password,
          ssn: body.ssn || '',
          photoData: body.photoData || '',
          govData: body.govData || '',
          role: body.isAdmin ? 'admin' : 'employee',
          times: [],
          receipts: [],
          // Fechas programadas por el administrador (YYYY-MM-DD)
          schedules: []
        };
        // Añadir información de pago
        newUser.payType = body.payType || 'hora';
        newUser.payRate = typeof body.payRate === 'number' && !isNaN(body.payRate) ? body.payRate : 0;
        data.users.push(newUser);
        writeData(data);
        sendJSON(res, 201, { success: true, user: newUser });
        return;
      }
      // /api/login
      if (method === 'POST' && parts[1] === 'login') {
        const body = await parseRequestBody(req);
        const { email, password } = body;
        const user = data.users.find(u => u.email === (email || '').toLowerCase());
        if (!user || user.password !== password) {
          sendJSON(res, 401, { success: false, message: 'Credenciales incorrectas' });
          return;
        }
        sendJSON(res, 200, { success: true, user: { id: user.id, firstName: user.firstName, lastName: user.lastName, role: user.role } });
        return;
      }
      // /api/users
      if (parts[1] === 'users') {
        // GET /api/users
        if (method === 'GET' && parts.length === 2) {
          // Devuelve usuarios sin contraseñas
          const users = data.users.map(u => ({ ...u, password: undefined }));
          sendJSON(res, 200, users);
          return;
        }
        const userId = parts[2];
        const user = data.users.find(u => u.id === userId);
        if (!user) {
          sendJSON(res, 404, { message: 'Usuario no encontrado' });
          return;
        }
        // GET /api/users/:id
        if (method === 'GET' && parts.length === 3) {
          const { password, ...userSafe } = user;
          sendJSON(res, 200, userSafe);
          return;
        }
        // PUT /api/users/:id/password - actualizar contraseña
        if (method === 'PUT' && parts[3] === 'password') {
          const body = await parseRequestBody(req);
          const { oldPassword, newPassword } = body;
          if (!oldPassword || !newPassword) {
            sendJSON(res, 400, { success: false, message: 'Se requieren la contraseña actual y la nueva contraseña' });
            return;
          }
          // Verificar contraseña actual
          if (user.password !== oldPassword) {
            sendJSON(res, 403, { success: false, message: 'Contraseña actual incorrecta' });
            return;
          }
          user.password = newPassword;
          writeData(data);
          sendJSON(res, 200, { success: true });
          return;
        }
        // POST /api/users/:id/clock
        if (method === 'POST' && parts[3] === 'clock') {
          // Toggle clock
          const times = user.times || [];
          const now = new Date().toISOString();
          if (times.length > 0 && !times[times.length - 1].clockOut) {
            times[times.length - 1].clockOut = now;
          } else {
            times.push({ clockIn: now, clockOut: null });
          }
          user.times = times;
          writeData(data);
          sendJSON(res, 200, { success: true, times });
          return;
        }
        // GET /api/users/:id/times
        if (method === 'GET' && parts[3] === 'times') {
          sendJSON(res, 200, user.times || []);
          return;
        }
        // GET /api/users/:id/schedules - devuelve fechas programadas
        if (method === 'GET' && parts[3] === 'schedules') {
          sendJSON(res, 200, user.schedules || []);
          return;
        }
        // GET /api/users/:id/receipts
        if (method === 'GET' && parts[3] === 'receipts') {
          sendJSON(res, 200, user.receipts || []);
          return;
        }
        // POST /api/users/:id/receipts
        if (method === 'POST' && parts[3] === 'receipts') {
          const body = await parseRequestBody(req);
          const { category, imageData, note, amount } = body;
          if (!category || !imageData) {
            sendJSON(res, 400, { success: false, message: 'Faltan datos del recibo' });
            return;
          }
          // Registrar recibo con monto (puede ser nulo)
          const receipt = {
            id: 'rcp_' + Math.random().toString(36).substr(2, 9),
            date: new Date().toISOString(),
            category,
            imageData,
            note: note || '',
            amount: amount !== undefined && !isNaN(amount) ? Number(amount) : null
          };
          user.receipts = user.receipts || [];
          user.receipts.push(receipt);
          writeData(data);
          sendJSON(res, 201, { success: true, receipt });
          return;
        }

        // POST /api/users/:id/schedules - añade una fecha programada
        if (method === 'POST' && parts[3] === 'schedules') {
          const body = await parseRequestBody(req);
          const date = body.date;
          if (!date) {
            sendJSON(res, 400, { success: false, message: 'Fecha requerida' });
            return;
          }
          if (!user.schedules) user.schedules = [];
          if (!user.schedules.includes(date)) {
            user.schedules.push(date);
            writeData(data);
          }
          sendJSON(res, 200, { success: true, schedules: user.schedules });
          return;
        }
        // DELETE /api/users/:id/schedules - elimina una fecha programada
        if (method === 'DELETE' && parts[3] === 'schedules') {
          const body = await parseRequestBody(req);
          const date = body.date;
          if (!date) {
            sendJSON(res, 400, { success: false, message: 'Fecha requerida' });
            return;
          }
          if (Array.isArray(user.schedules)) {
            user.schedules = user.schedules.filter(d => d !== date);
            writeData(data);
          }
          sendJSON(res, 200, { success: true, schedules: user.schedules || [] });
          return;
        }

        // PUT /api/users/:id/pay - actualizar tipo y tarifa de pago
        if (method === 'PUT' && parts[3] === 'pay') {
          const body = await parseRequestBody(req);
          if (body.payType) {
            user.payType = body.payType;
          }
          if (body.payRate !== undefined && !isNaN(body.payRate)) {
            user.payRate = Number(body.payRate);
          }
          writeData(data);
          sendJSON(res, 200, { success: true, user: { id: user.id, payType: user.payType, payRate: user.payRate } });
          return;
        }
        // DELETE /api/users/:id - eliminar cuenta (requiere confirmación de email)
        if (method === 'DELETE' && parts.length === 3) {
          const body = await parseRequestBody(req);
          const email = (body.email || '').toLowerCase();
          if (!email) {
            sendJSON(res, 400, { success: false, message: 'Se requiere el correo para confirmar la eliminación' });
            return;
          }
          if (email !== user.email) {
            sendJSON(res, 403, { success: false, message: 'El correo no coincide con la cuenta' });
            return;
          }
          // Eliminar usuario de la lista
          data.users = data.users.filter(u => u.id !== userId);
          // Eliminar usuario de todos los grupos
          if (Array.isArray(data.groups)) {
            data.groups.forEach(g => {
              g.members = (g.members || []).filter(mid => mid !== userId);
            });
          }
          writeData(data);
          sendJSON(res, 200, { success: true });
          return;
        }
      }
      // /api/groups
      if (parts[1] === 'groups') {
        // GET /api/groups
        if (method === 'GET' && parts.length === 2) {
          sendJSON(res, 200, data.groups);
          return;
        }
        // POST /api/groups
        if (method === 'POST' && parts.length === 2) {
          const body = await parseRequestBody(req);
          const name = (body.name || '').trim();
          if (!name) {
            sendJSON(res, 400, { success: false, message: 'Nombre de grupo requerido' });
            return;
          }
          if (data.groups.some(g => g.name.toLowerCase() === name.toLowerCase())) {
            sendJSON(res, 400, { success: false, message: 'Ya existe un grupo con ese nombre' });
            return;
          }
          const group = { id: 'grp_' + Math.random().toString(36).substr(2, 9), name, members: [] };
          data.groups.push(group);
          writeData(data);
          sendJSON(res, 201, { success: true, group });
          return;
        }
        const groupId = parts[2];
        const group = data.groups.find(g => g.id === groupId);
        if (!group) {
          sendJSON(res, 404, { message: 'Grupo no encontrado' });
          return;
        }
        // GET /api/groups/:id
        if (method === 'GET' && parts.length === 3) {
          sendJSON(res, 200, group);
          return;
        }
        // POST /api/groups/:id/users
        if (method === 'POST' && parts[3] === 'users') {
          const body = await parseRequestBody(req);
          const uid = body.userId;
          if (!uid) {
            sendJSON(res, 400, { success: false, message: 'userId requerido' });
            return;
          }
          if (!group.members.includes(uid)) {
            // Ensure each user belongs to only one group: remove from any other group
            if (Array.isArray(data.groups)) {
              data.groups.forEach(g => {
                if (g.id !== groupId && Array.isArray(g.members) && g.members.includes(uid)) {
                  g.members = g.members.filter(mid => mid !== uid);
                }
              });
            }
            group.members.push(uid);
            writeData(data);
          }
          sendJSON(res, 200, { success: true, group });
          return;
        }
        // DELETE /api/groups/:id/users/:userId
        if (method === 'DELETE' && parts[3] === 'users' && parts[4]) {
          const uid = parts[4];
          group.members = group.members.filter(mid => mid !== uid);
          writeData(data);
          sendJSON(res, 200, { success: true });
          return;
        }
        // DELETE /api/groups/:id
        if (method === 'DELETE' && parts.length === 3) {
          data.groups = data.groups.filter(g => g.id !== groupId);
          writeData(data);
          sendJSON(res, 200, { success: true });
          return;
        }
      }
      // Exports
      if (parts[1] === 'exports') {
        // Exports user times/receipts
        if (parts[2] === 'user') {
          const userId = parts[3];
          const type = parts[4]; // times or receipts
          const format = parts[5]; // optional: pdf
          const user = data.users.find(u => u.id === userId);
          if (!user) {
            res.writeHead(404);
            res.end('Usuario no encontrado');
            return;
          }
          // Datos para CSV o PDF
          if (type === 'times') {
            const rows = [];
            rows.push(['Nombre', 'Entrada', 'Salida', 'Horas']);
            (user.times || []).forEach(t => {
              const start = t.clockIn ? formatDateTime(t.clockIn) : '';
              const end = t.clockOut ? formatDateTime(t.clockOut) : '';
              const hours = t.clockOut ? calcHours(t.clockIn, t.clockOut).toFixed(2) : '';
              rows.push([`${user.firstName} ${user.lastName}`, start, end, hours]);
            });
            if (format === 'pdf') {
              const pdfBuffer = generatePDF(
                `Horas de ${user.firstName} ${user.lastName}`,
                ['Nombre', 'Entrada', 'Salida', 'Horas'],
                rows.slice(1)
              );
              res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="horas_${user.firstName}_${user.lastName}.pdf"`
              });
              res.end(pdfBuffer);
              return;
            } else {
              const csv = rows.map(r => r.map(escapeCsv).join(',')).join('\n');
              res.setHeader('Content-Type', 'text/csv');
              res.setHeader('Content-Disposition', `attachment; filename="horas_${user.firstName}_${user.lastName}.csv"`);
              res.end(csv);
              return;
            }
          }
          if (type === 'receipts') {
            const rows = [];
            // Cabeceras: incluimos la columna Monto
            rows.push(['Nombre', 'Fecha', 'Categoría', 'Descripción', 'Monto']);
            (user.receipts || []).forEach(r => {
              rows.push([
                `${user.firstName} ${user.lastName}`,
                formatDateTime(r.date),
                r.category,
                (r.note || '').replace(/\n/g, ' '),
                r.amount !== null && r.amount !== undefined ? r.amount.toFixed(2) : ''
              ]);
            });
            if (format === 'pdf') {
              const pdfBuffer = generatePDF(
                `Recibos de ${user.firstName} ${user.lastName}`,
                ['Nombre', 'Fecha', 'Categoría', 'Descripción', 'Monto'],
                rows.slice(1)
              );
              res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="recibos_${user.firstName}_${user.lastName}.pdf"`
              });
              res.end(pdfBuffer);
              return;
            } else {
              const csv = rows.map(r => r.map(escapeCsv).join(',')).join('\n');
              res.setHeader('Content-Type', 'text/csv');
              res.setHeader('Content-Disposition', `attachment; filename="recibos_${user.firstName}_${user.lastName}.csv"`);
              res.end(csv);
              return;
            }
          }
        }
        // Exports group times/receipts
        if (parts[2] === 'group') {
          const groupId = parts[3];
          const type = parts[4];
          const format = parts[5]; // optional: pdf
          const group = data.groups.find(g => g.id === groupId);
          if (!group) {
            res.writeHead(404);
            res.end('Grupo no encontrado');
            return;
          }
          if (type === 'times') {
            const rows = [];
            rows.push(['Grupo', 'Nombre', 'Entrada', 'Salida', 'Horas']);
            // Ordenar miembros alfabéticamente por nombre completo
            const sortedMembers = (group.members || []).slice().sort((a, b) => {
              const ua = data.users.find(u => u.id === a);
              const ub = data.users.find(u => u.id === b);
              const nameA = ua ? `${ua.firstName} ${ua.lastName}`.toLowerCase() : '';
              const nameB = ub ? `${ub.firstName} ${ub.lastName}`.toLowerCase() : '';
              return nameA.localeCompare(nameB);
            });
            sortedMembers.forEach(uid => {
              const user = data.users.find(u => u.id === uid);
              if (!user) return;
              // Ordenar registros de tiempo por fecha de entrada
              const sortedTimes = (user.times || []).slice().sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));
              sortedTimes.forEach(t => {
                const start = t.clockIn ? formatDateTime(t.clockIn) : '';
                const end = t.clockOut ? formatDateTime(t.clockOut) : '';
                const hours = t.clockOut ? calcHours(t.clockIn, t.clockOut).toFixed(2) : '';
                rows.push([group.name, `${user.firstName} ${user.lastName}`, start, end, hours]);
              });
            });
            if (format === 'pdf') {
              const pdfBuffer = generatePDF(
                `Horas del grupo ${group.name}`,
                ['Grupo', 'Nombre', 'Entrada', 'Salida', 'Horas'],
                rows.slice(1)
              );
              res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="horas_grupo_${group.name}.pdf"`
              });
              res.end(pdfBuffer);
              return;
            } else {
              const csv = rows.map(r => r.map(escapeCsv).join(',')).join('\n');
              res.setHeader('Content-Type', 'text/csv');
              res.setHeader('Content-Disposition', `attachment; filename="horas_grupo_${group.name}.csv"`);
              res.end(csv);
              return;
            }
          }
          if (type === 'receipts') {
            const rows = [];
            // Cabeceras con columna Monto
            rows.push(['Grupo', 'Nombre', 'Fecha', 'Categoría', 'Descripción', 'Monto']);
            // Ordenar miembros alfabéticamente
            const sortedMembers = (group.members || []).slice().sort((a, b) => {
              const ua = data.users.find(u => u.id === a);
              const ub = data.users.find(u => u.id === b);
              const nameA = ua ? `${ua.firstName} ${ua.lastName}`.toLowerCase() : '';
              const nameB = ub ? `${ub.firstName} ${ub.lastName}`.toLowerCase() : '';
              return nameA.localeCompare(nameB);
            });
            sortedMembers.forEach(uid => {
              const user = data.users.find(u => u.id === uid);
              if (!user) return;
              // Ordenar recibos por fecha
              const sortedReceipts = (user.receipts || []).slice().sort((a, b) => new Date(a.date) - new Date(b.date));
              sortedReceipts.forEach(r => {
                rows.push([
                  group.name,
                  `${user.firstName} ${user.lastName}`,
                  formatDateTime(r.date),
                  r.category,
                  (r.note || '').replace(/\n/g, ' '),
                  r.amount !== null && r.amount !== undefined ? r.amount.toFixed(2) : ''
                ]);
              });
            });
            if (format === 'pdf') {
              const pdfBuffer = generatePDF(
                `Recibos del grupo ${group.name}`,
                ['Grupo', 'Nombre', 'Fecha', 'Categoría', 'Descripción', 'Monto'],
                rows.slice(1)
              );
              res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="recibos_grupo_${group.name}.pdf"`
              });
              res.end(pdfBuffer);
              return;
            } else {
              const csv = rows.map(r => r.map(escapeCsv).join(',')).join('\n');
              res.setHeader('Content-Type', 'text/csv');
              res.setHeader('Content-Disposition', `attachment; filename="recibos_grupo_${group.name}.csv"`);
              res.end(csv);
              return;
            }
          }
        }
      }
      // Endpoint no encontrado
      sendJSON(res, 404, { message: 'Endpoint no encontrado' });
    } catch (err) {
      console.error(err);
      sendJSON(res, 500, { message: 'Error interno del servidor' });
    }
    return;
  }
  // Servir archivos estáticos
  let filePath = url === '/' ? '/index.html' : url;
  // Prevenir acceso fuera de la carpeta
  filePath = decodeURIComponent(filePath);
  const safeSuffix = path.normalize(filePath).replace(/^\.+/,'');
  const finalPath = path.join(PUBLIC_DIR, safeSuffix);
  // Extensión para tipo de contenido
  const ext = path.extname(finalPath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.ico': 'image/x-icon'
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(finalPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// Utilidades para CSV en exportaciones
function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}
function calcHours(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return (end - start) / (1000 * 60 * 60);
}
function escapeCsv(value) {
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
