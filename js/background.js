// Fondo neuronal animado sin dependencias externas.
// En lugar de usar Three.js (que requiere descargar bibliotecas externas),
// implementamos manualmente una red 3D proyectada en 2D utilizando
// Canvas 2D. Los nodos y las conexiones se rotan lentamente en el espacio.
(function () {
  // Configuración general
  const DISTANCE = 600;

  // Configuración global editable a través de la interfaz de administración.
  // Si ya existe window.backgroundSettings (por ejemplo, configurado en otra
  // parte), se respeta; de lo contrario se asignan valores por defecto.
  const defaultSettings = {
    nodeCount: 120,
    connectionProb: 0.05,
    rotationSpeed: 0.002,
    colorSpeed: 0.2,
    pulseFrequency: 0.05,
    pulseSpeedMin: 0.008,
    pulseSpeedMax: 0.02
  };
  if (!window.backgroundSettings) {
    window.backgroundSettings = { ...defaultSettings };
  } else {
    // completar con valores por defecto si faltan
    for (const key in defaultSettings) {
      if (window.backgroundSettings[key] === undefined) {
        window.backgroundSettings[key] = defaultSettings[key];
      }
    }
  }

  let canvas, ctx;
  let nodes = [];
  let edges = [];
  let width, height;
  let nodeColor = '#0d6efd';
  let lineColor = '#444444';
  // Variables para el efecto de color lento y los pulsos
  let hue = 0;
  const pulses = [];

  // Utilidad para detectar modo oscuro
  function isDarkMode() {
    return document.body.classList.contains('dark-mode');
  }
  // Actualiza colores según el tema
  function updateColors() {
    if (isDarkMode()) {
      nodeColor = '#0dcaf0';
      lineColor = '#ffffff';
    } else {
      nodeColor = '#0d6efd';
      lineColor = '#444444';
    }
  }

  // Convierte de HSL a una cadena hex (sin '#')
  function hslToHex(h, s, l) {
    // h en [0, 360], s y l en [0,100]
    s /= 100;
    l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) {
      r = c; g = x; b = 0;
    } else if (h < 120) {
      r = x; g = c; b = 0;
    } else if (h < 180) {
      r = 0; g = c; b = x;
    } else if (h < 240) {
      r = 0; g = x; b = c;
    } else if (h < 300) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }
    const to255 = val => Math.round((val + m) * 255);
    return ((1 << 24) + (to255(r) << 16) + (to255(g) << 8) + to255(b)).toString(16).slice(1);
  }

  function initCanvas() {
    // Crear contenedor si no existe
    let container = document.getElementById('bgCanvasContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'bgCanvasContainer';
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.zIndex = '-1';
      container.style.pointerEvents = 'none';
      document.body.prepend(container);
    }
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
    container.appendChild(canvas);
    onResize();
  }

  function generateNetwork() {
    nodes = [];
    edges = [];
    // Calcular cantidad de nodos relativa al tamaño de la pantalla
    const minDim = Math.min(window.innerWidth, window.innerHeight);
    const scaleFactor = minDim / 800;
    const baseCount = window.backgroundSettings.nodeCount || defaultSettings.nodeCount;
    const numNodes = Math.floor(baseCount * (scaleFactor > 0 ? scaleFactor : 1));
    for (let i = 0; i < numNodes; i++) {
      // Posiciones iniciales en un cubo centrado (x,y,z)
      nodes.push({
        x: (Math.random() - 0.5) * 600,
        y: (Math.random() - 0.5) * 600,
        z: (Math.random() - 0.5) * 600,
      });
    }
    // Conectar nodos aleatoriamente
    const connectionProb = window.backgroundSettings.connectionProb || defaultSettings.connectionProb;
    for (let i = 0; i < numNodes; i++) {
      for (let j = i + 1; j < numNodes; j++) {
        if (Math.random() < connectionProb) {
          edges.push({ a: i, b: j });
        }
      }
    }
    // Limpiar pulsos existentes al regenerar la red
    pulses.length = 0;
  }

  // Rotaciones 3D simples en torno a ejes X e Y
  function rotateNodes() {
    const rs = window.backgroundSettings.rotationSpeed || defaultSettings.rotationSpeed;
    for (const node of nodes) {
      // Rotación en X
      const y1 = node.y;
      const z1 = node.z;
      const cosX = Math.cos(rs);
      const sinX = Math.sin(rs);
      node.y = y1 * cosX - z1 * sinX;
      node.z = y1 * sinX + z1 * cosX;
      // Rotación en Y
      const x1 = node.x;
      const z2 = node.z;
      const cosY = Math.cos(rs);
      const sinY = Math.sin(rs);
      node.x = x1 * cosY + z2 * sinY;
      node.z = -x1 * sinY + z2 * cosY;
    }
  }

  // Proyección de punto 3D a 2D (perspectiva simple)
  function project(node) {
    const factor = DISTANCE / (DISTANCE + node.z);
    return {
      x: node.x * factor + width / 2,
      y: node.y * factor + height / 2,
      // factor se devuelve por si se desea variar la opacidad según profundidad
      scale: factor
    };
  }

  function draw() {
    // Fondo negro
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    // Dibujar conexiones (líneas base)
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    for (const edge of edges) {
      const a = nodes[edge.a];
      const b = nodes[edge.b];
      const pa = project(a);
      const pb = project(b);
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;
    // Calcular color cambiante para nodos: ciclo de color en 360°
    const dynamicHue = (hue % 360);
    const dynColor = '#' + hslToHex(dynamicHue, 100, 50);
    // Dibujar nodos como círculos con color cambiante
    ctx.fillStyle = dynColor;
    for (const node of nodes) {
      const p = project(node);
      const size = 2.5 * p.scale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    // Dibujar pulsos (rayo neural) como puntos brillantes que se mueven a lo largo de las conexiones
    ctx.fillStyle = '#ffce00';
    for (const pulse of pulses) {
      const edge = edges[pulse.edgeIndex];
      if (!edge) continue;
      const a = nodes[edge.a];
      const b = nodes[edge.b];
      // Interpolación lineal
      const x = a.x + (b.x - a.x) * pulse.progress;
      const y = a.y + (b.y - a.y) * pulse.progress;
      const z = a.z + (b.z - a.z) * pulse.progress;
      const proj = project({ x, y, z });
      const size = 3.5 * proj.scale;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function animate() {
    // Rotar nodos para movimiento
    rotateNodes();
    // Actualizar ciclo de color para nodos con velocidad configurable
    const cSpeed = window.backgroundSettings.colorSpeed || defaultSettings.colorSpeed;
    hue = (hue + cSpeed) % 360;
    // Actualizar y generar pulsos
    updatePulses();
    // Dibujar escena completa
    draw();
    requestAnimationFrame(animate);
  }

  function onResize() {
    width = window.innerWidth;
    height = window.innerHeight;
    if (canvas) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  // Actualiza la lista de pulsos: genera nuevos y avanza existentes
  function updatePulses() {
    // Generar un nuevo pulso con probabilidad configurable en cada fotograma
    const freq = window.backgroundSettings.pulseFrequency || defaultSettings.pulseFrequency;
    if (edges.length > 0 && Math.random() < freq) {
      const index = Math.floor(Math.random() * edges.length);
      const minSp = window.backgroundSettings.pulseSpeedMin || defaultSettings.pulseSpeedMin;
      const maxSp = window.backgroundSettings.pulseSpeedMax || defaultSettings.pulseSpeedMax;
      pulses.push({ edgeIndex: index, progress: 0, speed: minSp + Math.random() * (maxSp - minSp) });
    }
    // Avanzar pulsos y eliminar los que completan su recorrido
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.progress += p.speed;
      if (p.progress >= 1) {
        pulses.splice(i, 1);
      }
    }
  }

  // Inicializa todo al cargar el documento
  document.addEventListener('DOMContentLoaded', () => {
    initCanvas();
    updateColors();
    generateNetwork();
    animate();
    window.addEventListener('resize', () => {
      onResize();
      // Regenerar la red con nuevo tamaño para mantener densidad
      generateNetwork();
    });
    // Parchea toggleTheme para actualizar colores del fondo
    const originalToggle = window.toggleTheme;
    if (originalToggle) {
      window.toggleTheme = function (...args) {
        originalToggle.apply(this, args);
        updateColors();
      };
    }

    // Expone una función pública para regenerar la red cuando cambian los parámetros
    window.backgroundRegenerate = function () {
      // Regenerar nodos y conexiones
      nodes = [];
      edges = [];
      generateNetwork();
    };
  });
})();