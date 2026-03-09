/**
 * PlusPagos Mock Simple - Simulador de Pasarela de Pago
 * Summer Campus 2026 - i2T Software Factory
 * 
 * Un simulador fácil de entender y configurar.
 */

const express = require('express');
const { decryptString, generatePlatformId } = require('./crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// CONFIGURACIÓN - Los alumnos pueden modificar esto
// ============================================
const CONFIG = {
  MERCHANT_GUID: 'test-merchant-001',
  SECRET_KEY: 'clave-secreta-campus-2026',
  WEBHOOK_URL: process.env.WEBHOOK_URL || null  // Se configura desde el dashboard
};

// Almacén en memoria de transacciones
const transactions = [];

// ============================================
// MIDDLEWARES
// ============================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ============================================
// TARJETAS DE PRUEBA
// ============================================
const TEST_CARDS = {
  '4242424242424242': { status: 'success', name: 'Visa Aprobada' },
  '4000000000000002': { status: 'rejected', name: 'Visa Rechazada' },
  '5555555555554444': { status: 'success', name: 'Mastercard Aprobada' },
  '5105105105105100': { status: 'rejected', name: 'Mastercard Rechazada' },
  '378282246310005': { status: 'success', name: 'Amex Aprobada' },
  '371449635398431': { status: 'rejected', name: 'Amex Rechazada' }
};

// ============================================
// PÁGINA PRINCIPAL - Documentación
// ============================================
app.get('/', (req, res) => {
  res.send(getHomePage());
});

// ============================================
// POST / - Recibe el pago del comercio
// ============================================
app.post('/', (req, res) => {
  console.log('\\n=== PAGO RECIBIDO ===');
  console.log('Body keys:', Object.keys(req.body));
  
  try {
    const { Comercio, TransaccionComercioId, Monto, Informacion } = req.body;
    const { CallbackSuccess, CallbackCancel, UrlSuccess, UrlError } = req.body;
    
    // Validar comercio
    if (Comercio !== CONFIG.MERCHANT_GUID) {
      console.log('Error: Comercio inválido:', Comercio);
      return res.status(400).send('<h1>Error: Comercio inválido</h1>');
    }
    
    // Desencriptar monto
    const montoDecrypted = decryptString(Monto, CONFIG.SECRET_KEY);
    console.log('Monto desencriptado:', montoDecrypted);
    
    if (!montoDecrypted) {
      console.log('Error: No se pudo desencriptar el monto');
      return res.status(400).send('<h1>Error: Monto inválido</h1>');
    }
    
    const montoCentavos = parseInt(montoDecrypted, 10);
    const montoDecimal = (montoCentavos / 100).toFixed(2);
    
    // Desencriptar URLs
    const urlSuccess = decryptString(UrlSuccess, CONFIG.SECRET_KEY) || '';
    const urlError = decryptString(UrlError, CONFIG.SECRET_KEY) || '';
    const callbackSuccess = decryptString(CallbackSuccess, CONFIG.SECRET_KEY) || '';
    const callbackCancel = decryptString(CallbackCancel, CONFIG.SECRET_KEY) || '';
    
    // Crear transacción
    const transaction = {
      id: generatePlatformId(),
      comercioId: TransaccionComercioId,
      monto: montoDecimal,
      montoCentavos,
      status: 'pending',
      urlSuccess,
      urlError,
      callbackSuccess,
      callbackCancel,
      createdAt: new Date().toISOString()
    };
    
    transactions.push(transaction);
    console.log('Transacción creada:', transaction.id);
    
    // Mostrar formulario de pago
    res.send(getPaymentPage(transaction));
    
  } catch (error) {
    console.error('Error procesando pago:', error);
    res.status(500).send('<h1>Error interno</h1><p>' + error.message + '</p>');
  }
});

// ============================================
// POST /procesar-pago - Procesa la tarjeta
// ============================================
app.post('/procesar-pago', async (req, res) => {
  const { transactionId, cardNumber, cardName, cardExpiry, cardCvv } = req.body;
  
  console.log('\\n=== PROCESANDO PAGO ===');
  console.log('Transaction ID:', transactionId);
  console.log('Card:', cardNumber.replace(/\\d{12}/, '****'));
  
  const txn = transactions.find(t => t.id === parseInt(transactionId));
  if (!txn) {
    return res.status(404).send('<h1>Transacción no encontrada</h1>');
  }
  
  // Determinar resultado según tarjeta
  const cardClean = cardNumber.replace(/\\s/g, '');
  const cardInfo = TEST_CARDS[cardClean] || { status: 'success', name: 'Tarjeta Genérica' };
  
  // Simular delay de procesamiento
  await new Promise(r => setTimeout(r, 1500));
  
  txn.status = cardInfo.status === 'success' ? 'approved' : 'rejected';
  txn.cardType = cardInfo.name;
  txn.processedAt = new Date().toISOString();
  
  console.log('Resultado:', txn.status);
  
  // Enviar webhook si está configurado
  if (CONFIG.WEBHOOK_URL) {
    sendWebhook(txn);
  }
  
  // Enviar callback al comercio
  const callbackUrl = txn.status === 'approved' ? txn.callbackSuccess : txn.callbackCancel;
  if (callbackUrl) {
    sendCallback(callbackUrl, txn);
  }
  
  // Redirigir al usuario
  const redirectUrl = txn.status === 'approved' ? txn.urlSuccess : txn.urlError;
  
  if (redirectUrl) {
    res.redirect(redirectUrl);
  } else {
    res.send(getResultPage(txn));
  }
});

// ============================================
// DASHBOARD
// ============================================
app.get('/dashboard', (req, res) => {
  res.send(getDashboardPage());
});

app.get('/api/transactions', (req, res) => {
  res.json(transactions.slice(-20).reverse());
});

app.get('/api/config', (req, res) => {
  res.json({
    merchantGuid: CONFIG.MERCHANT_GUID,
    secretKey: CONFIG.SECRET_KEY,
    webhookUrl: CONFIG.WEBHOOK_URL
  });
});

app.post('/api/config', (req, res) => {
  const { webhookUrl, secretKey } = req.body;
  if (webhookUrl !== undefined) CONFIG.WEBHOOK_URL = webhookUrl || null;
  if (secretKey) CONFIG.SECRET_KEY = secretKey;
  res.json({ success: true, config: { webhookUrl: CONFIG.WEBHOOK_URL, secretKey: CONFIG.SECRET_KEY } });
});

// ============================================
// FUNCIONES AUXILIARES
// ============================================
async function sendWebhook(txn) {
  try {
    const payload = {
      Tipo: 'PAGO',
      TransaccionPlataformaId: txn.id.toString(),
      TransaccionComercioId: txn.comercioId,
      Monto: txn.monto,
      EstadoId: txn.status === 'approved' ? '3' : '4',
      Estado: txn.status === 'approved' ? 'REALIZADA' : 'RECHAZADA',
      FechaProcesamiento: txn.processedAt
    };
    
    console.log('Enviando webhook a:', CONFIG.WEBHOOK_URL);
    
    const response = await fetch(CONFIG.WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    console.log('Webhook response:', response.status);
  } catch (error) {
    console.error('Error enviando webhook:', error.message);
  }
}

async function sendCallback(url, txn) {
  try {
    console.log('Enviando callback a:', url);
    
    const payload = {
      transaccionId: txn.id,
      comercioId: txn.comercioId,
      monto: txn.monto,
      estado: txn.status,
      fecha: txn.processedAt
    };
    
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error('Error enviando callback:', error.message);
  }
}

// ============================================
// PÁGINAS HTML
// ============================================
function getHomePage() {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PlusPagos Mock</title>' +
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:40px}' +
    '.container{max-width:800px;margin:0 auto}h1{color:#38bdf8;margin-bottom:20px}h2{color:#94a3b8;margin:30px 0 15px;font-size:1.2rem}' +
    'pre{background:#1e293b;padding:20px;border-radius:8px;overflow-x:auto;margin:10px 0}code{color:#22d3ee}' +
    '.card{background:#1e293b;border-radius:12px;padding:25px;margin:20px 0}' +
    '.btn{display:inline-block;background:#3b82f6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin:10px 10px 10px 0}' +
    'table{width:100%;border-collapse:collapse;margin:15px 0}th,td{padding:10px;text-align:left;border-bottom:1px solid #334155}' +
    '</style></head><body><div class="container">' +
    '<h1>🏦 PlusPagos Mock</h1><p>Simulador de pasarela de pago - Summer Campus 2026</p>' +
    '<div class="card"><h2>🔑 Credenciales</h2>' +
    '<p><strong>GUID:</strong> <code>' + CONFIG.MERCHANT_GUID + '</code></p>' +
    '<p><strong>Secret:</strong> <code>' + CONFIG.SECRET_KEY + '</code></p></div>' +
    '<div class="card"><h2>💳 Tarjetas de Prueba</h2><table><tr><th>Número</th><th>Resultado</th></tr>' +
    '<tr><td><code>4242 4242 4242 4242</code></td><td>✅ Aprobada</td></tr>' +
    '<tr><td><code>4000 0000 0000 0002</code></td><td>❌ Rechazada</td></tr>' +
    '<tr><td><code>5555 5555 5555 4444</code></td><td>✅ Aprobada</td></tr>' +
    '<tr><td><code>5105 1051 0510 5100</code></td><td>❌ Rechazada</td></tr></table></div>' +
    '<a href="/dashboard" class="btn">📊 Dashboard</a>' +
    '</div></body></html>';
}

function getPaymentPage(txn) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pagar - PlusPagos</title>' +
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:linear-gradient(135deg,#1e3a5f,#0f172a);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}' +
    '.card{background:white;border-radius:16px;padding:40px;max-width:420px;width:100%;box-shadow:0 25px 50px rgba(0,0,0,0.3)}' +
    'h1{color:#1e293b;font-size:1.5rem;margin-bottom:5px}' +
    '.amount{font-size:2.5rem;color:#059669;font-weight:700;margin:20px 0}' +
    '.form-group{margin-bottom:20px}label{display:block;color:#64748b;font-size:0.9rem;margin-bottom:6px}' +
    'input{width:100%;padding:14px;border:2px solid #e2e8f0;border-radius:8px;font-size:1rem}input:focus{outline:none;border-color:#3b82f6}' +
    '.row{display:flex;gap:15px}.row .form-group{flex:1}' +
    '.btn{width:100%;padding:16px;background:#3b82f6;color:white;border:none;border-radius:8px;font-size:1.1rem;font-weight:600;cursor:pointer}' +
    '.btn:hover{background:#2563eb}.hint{color:#94a3b8;font-size:0.8rem;margin-top:20px;text-align:center}' +
    '</style></head><body>' +
    '<div class="card"><h1>PlusPagos</h1><p style="color:#64748b">Completá los datos de tu tarjeta</p>' +
    '<div class="amount">$ ' + txn.monto + '</div>' +
    '<form action="/procesar-pago" method="POST">' +
    '<input type="hidden" name="transactionId" value="' + txn.id + '">' +
    '<div class="form-group"><label>Número de tarjeta</label><input type="text" name="cardNumber" placeholder="4242 4242 4242 4242" required maxlength="19"></div>' +
    '<div class="form-group"><label>Nombre en la tarjeta</label><input type="text" name="cardName" placeholder="JUAN PEREZ" required></div>' +
    '<div class="row"><div class="form-group"><label>Vencimiento</label><input type="text" name="cardExpiry" placeholder="MM/AA" required maxlength="5"></div>' +
    '<div class="form-group"><label>CVV</label><input type="text" name="cardCvv" placeholder="123" required maxlength="4"></div></div>' +
    '<button type="submit" class="btn">Pagar $ ' + txn.monto + '</button></form>' +
    '<p class="hint">💡 Usá 4242... para aprobar o 4000...0002 para rechazar</p>' +
    '</div></body></html>';
}

function getResultPage(txn) {
  const isSuccess = txn.status === 'approved';
  const icon = isSuccess ? '✅' : '❌';
  const color = isSuccess ? '#059669' : '#dc2626';
  const msg = isSuccess ? '¡Pago exitoso!' : 'Pago rechazado';
  
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Resultado</title>' +
    '<style>body{font-family:system-ui;background:#0f172a;min-height:100vh;display:flex;align-items:center;justify-content:center}' +
    '.card{background:white;border-radius:16px;padding:50px;text-align:center;max-width:400px}' +
    '.icon{font-size:4rem;margin-bottom:20px}h1{color:' + color + ';margin-bottom:10px}' +
    '.info{background:#f1f5f9;padding:15px;border-radius:8px;margin:20px 0;text-align:left}' +
    '.btn{display:inline-block;padding:12px 30px;background:#3b82f6;color:white;text-decoration:none;border-radius:8px;margin-top:20px}' +
    '</style></head><body><div class="card">' +
    '<div class="icon">' + icon + '</div><h1>' + msg + '</h1>' +
    '<div class="info"><p><strong>ID:</strong> ' + txn.id + '</p><p><strong>Monto:</strong> $' + txn.monto + '</p>' +
    '<p><strong>Comercio:</strong> ' + txn.comercioId + '</p></div>' +
    '<a href="/" class="btn">Volver</a></div></body></html>';
}

function getDashboardPage() {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Dashboard - PlusPagos</title>' +
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:30px}' +
    '.container{max-width:1000px;margin:0 auto}h1{color:#38bdf8;margin-bottom:30px}' +
    '.card{background:#1e293b;border-radius:12px;padding:25px;margin-bottom:20px}h2{margin-bottom:15px;color:#94a3b8}' +
    'input{padding:12px;border:2px solid #334155;border-radius:8px;background:#0f172a;color:white;width:100%;margin-bottom:10px}' +
    '.btn{padding:12px 24px;background:#3b82f6;color:white;border:none;border-radius:8px;cursor:pointer;margin-right:10px}' +
    'table{width:100%;border-collapse:collapse}th,td{padding:12px;text-align:left;border-bottom:1px solid #334155}' +
    '.success{color:#22c55e}.error{color:#ef4444}.pending{color:#eab308}' +
    '</style></head><body><div class="container"><h1>📊 Dashboard</h1>' +
    '<div class="card"><h2>⚙️ Configuración</h2>' +
    '<label style="color:#94a3b8">Secret Key:</label>' +
    '<input type="text" id="secretKey" placeholder="clave-secreta">' +
    '<label style="color:#94a3b8">Webhook URL (para notificaciones):</label>' +
    '<input type="text" id="webhookUrl" placeholder="http://tu-servidor/webhook">' +
    '<button class="btn" onclick="saveConfig()">Guardar</button></div>' +
    '<div class="card"><h2>💳 Transacciones</h2><table id="txnTable"><thead><tr><th>ID</th><th>Comercio</th><th>Monto</th><th>Estado</th><th>Fecha</th></tr></thead><tbody></tbody></table></div>' +
    '</div><script>' +
    'async function loadConfig(){const r=await fetch("/api/config");const c=await r.json();document.getElementById("secretKey").value=c.secretKey||"";document.getElementById("webhookUrl").value=c.webhookUrl||"";}' +
    'async function saveConfig(){const s=document.getElementById("secretKey").value;const w=document.getElementById("webhookUrl").value;await fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({secretKey:s,webhookUrl:w})});alert("Guardado!");}' +
    'async function loadTxns(){const r=await fetch("/api/transactions");const t=await r.json();const b=document.querySelector("#txnTable tbody");b.innerHTML=t.map(x=>"<tr><td>"+x.id+"</td><td>"+x.comercioId+"</td><td>$"+x.monto+"</td><td class=\'"+(x.status==="approved"?"success":x.status==="rejected"?"error":"pending")+"\'>"+x.status+"</td><td>"+new Date(x.createdAt).toLocaleString()+"</td></tr>").join("");}' +
    'loadConfig();loadTxns();setInterval(loadTxns,5000);' +
    '</script></body></html>';
}

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  🏦 PlusPagos Mock Simple                                  ║');
  console.log('║  Summer Campus 2026 - i2T Software Factory                ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  🌐 Servidor:   http://localhost:' + PORT + '                       ║');
  console.log('║  📊 Dashboard:  http://localhost:' + PORT + '/dashboard             ║');
  console.log('╠════════════════════════════════════════════════════════════╣');
  console.log('║  🔑 GUID:   ' + CONFIG.MERCHANT_GUID + '                          ║');
  console.log('║  🔐 Secret: ' + CONFIG.SECRET_KEY + '               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
});
