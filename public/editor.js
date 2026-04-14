const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let bgImage = null;
let rawPoints = [];

// Handle image upload
document.getElementById('imgLoader').addEventListener('change', function(e) {
  const reader = new FileReader();
  reader.onload = function(event) {
    const img = new Image();
    img.onload = function() {
      // Resize canvas to match image or scale image
      canvas.width = Math.min(img.width, 1600);
      canvas.height = (img.height / img.width) * canvas.width;
      bgImage = img;
      render();
    }
    img.src = event.target.result;
  }
  reader.readAsDataURL(e.target.files[0]);
});

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  
  rawPoints.push({x, y});
  render();
});

document.getElementById('undoBtn').addEventListener('click', () => {
  rawPoints.pop();
  render();
});

document.getElementById('clearBtn').addEventListener('click', () => {
  rawPoints = [];
  render();
});

document.getElementById('exportBtn').addEventListener('click', () => {
  if(rawPoints.length === 0) return;
  
  let output = "[\n";
  rawPoints.forEach((p, idx) => {
    const rx = (p.x / canvas.width).toFixed(3);
    const ry = (p.y / canvas.height).toFixed(3);
    output += `  {x: w * ${rx}, y: h * ${ry}}${idx === rawPoints.length-1 ? '' : ','}\n`;
  });
  output += "];";
  
  navigator.clipboard.writeText(output).then(() => {
    document.getElementById('status').innerText = "Data Structure Copied to Clipboard!";
    setTimeout(() => document.getElementById('status').innerText = "", 3000);
  });
});

// MATH
function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
      (2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function generateSpline(points, resolution = 15) {
  if (points.length < 3) return points;
  const spline = [];
  const pts = [...points];
  pts.unshift(points[points.length - 1]);
  pts.push(points[0]);
  pts.push(points[1]);

  for (let i = 1; i < pts.length - 2; i++) {
    for (let j = 0; j < resolution; j++) {
      const t = j / resolution;
      spline.push({
        x: catmullRom(pts[i - 1].x, pts[i].x, pts[i + 1].x, pts[i + 2].x, t),
        y: catmullRom(pts[i - 1].y, pts[i].y, pts[i + 1].y, pts[i + 2].y, t)
      });
    }
  }
  return spline;
}

function render() {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  if (bgImage) {
    ctx.globalAlpha = 0.5; // Make image slightly transparent so drawing pops
    ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;
  }

  if (rawPoints.length < 3) {
    // Just draw raw points
    ctx.fillStyle = '#00FFDD';
    rawPoints.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2); ctx.fill();
    });
    return;
  }

  const sp = generateSpline(rawPoints);
  
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Grass
  ctx.beginPath();
  ctx.moveTo(sp[0].x, sp[0].y);
  for(let i=1; i<sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(45, 90, 39, 0.8)';
  ctx.lineWidth = 110;
  ctx.stroke();

  // Asphalt
  ctx.beginPath();
  ctx.moveTo(sp[0].x, sp[0].y);
  for(let i=1; i<sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(51, 51, 51, 0.9)';
  ctx.lineWidth = 80;
  ctx.stroke();

  // Nodes
  ctx.fillStyle = '#FF0055';
  rawPoints.forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI*2); ctx.fill();
  });
}

render();
