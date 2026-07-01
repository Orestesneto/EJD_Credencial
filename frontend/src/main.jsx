import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Html5Qrcode } from "html5-qrcode";
import "./styles.css";

const tokenKey = "ejd_token";
const confirmedPaymentSeenKey = "ejd_confirmed_payment_seen";
const roles = {
  usuarios: "usuarios",
  participant: "usuarios",
  checkin: "Check-in",
  admin: "Área exclusiva"
};

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidCpf(value) {
  const cpf = digits(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const calcDigit = (size) => {
    let sum = 0;
    for (let i = 0; i < size; i += 1) sum += Number(cpf[i]) * (size + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calcDigit(9) === Number(cpf[9]) && calcDigit(10) === Number(cpf[10]);
}

async function api(path, options = {}) {
  const token = localStorage.getItem(tokenKey);
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Falha na solicitação.");
  return data;
}

function Notice({ notice }) {
  if (!notice?.text) return null;
  return <div className={`notice ${notice.type || "info"}`}>{notice.text}</div>;
}

function AuthScreen({ onAuth }) {
  const [tab, setTab] = useState("login");
  const [notice, setNotice] = useState(null);
  const [login, setLogin] = useState({ cpf: "", birthDate: "" });
  const [form, setForm] = useState({ name: "", cpf: "", whatsapp: "", birthDate: "" });

  async function submitLogin(event) {
    event.preventDefault();
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ cpf: digits(login.cpf), birthDate: digits(login.birthDate) })
      });
      localStorage.setItem(tokenKey, data.token);
      onAuth(data.user);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function submitRegister(event) {
    event.preventDefault();
    if (!isValidCpf(form.cpf)) {
      setNotice({ type: "error", text: "O CPF informado é inválido." });
      return;
    }
    try {
      const data = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          cpf: digits(form.cpf),
          whatsapp: digits(form.whatsapp),
          birthDate: digits(form.birthDate)
        })
      });
      localStorage.setItem(tokenKey, data.token);
      onAuth(data.user);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="brand">
          <span>EJD - credenciamento</span>
          <strong>Encontrão 25 Anos</strong>
          <small>Campina Grande - PB</small>
        </div>

        <div className="tabs">
          <button className={tab === "login" ? "active" : ""} onClick={() => setTab("login")}>Login</button>
          <button className={tab === "register" ? "active" : ""} onClick={() => setTab("register")}>Cadastro</button>
        </div>

        <Notice notice={notice} />

        {tab === "login" ? (
          <form onSubmit={submitLogin} className="form">
            <label>
              CPF
              <input inputMode="numeric" maxLength="11" value={login.cpf} onChange={(e) => setLogin({ ...login, cpf: digits(e.target.value).slice(0, 11) })} required />
            </label>
            <label>
              Data de nascimento
              <input inputMode="numeric" maxLength="9" value={login.birthDate} onChange={(e) => setLogin({ ...login, birthDate: digits(e.target.value).slice(0, 9) })} required />
            </label>
            <button className="primary">Entrar</button>
          </form>
        ) : (
          <form onSubmit={submitRegister} className="form">
            <label>
              Nome completo
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label>
              CPF
              <input inputMode="numeric" maxLength="11" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: digits(e.target.value).slice(0, 11) })} required />
            </label>
            <label>
              WhatsApp
              <input inputMode="numeric" maxLength="11" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: digits(e.target.value).slice(0, 11) })} required />
            </label>
            <label>
              Data de nascimento
              <input inputMode="numeric" maxLength="8" placeholder="ddmmaaaa" value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: digits(e.target.value).slice(0, 8) })} required />
            </label>
            <button className="primary">Cadastrar</button>
          </form>
        )}
      </section>
    </main>
  );
}

function Profile({ user }) {
  return (
    <section className="panel">
      <h2>Meu perfil</h2>
      <div className="profile-grid">
        <Info label="Nome" value={user.name} />
        <Info label="WhatsApp" value={user.whatsapp} />
        <Info label="CPF" value={user.cpf} />
        <Info label="Perfil" value={roles[user.role] || "usuarios"} />
      </div>
    </section>
  );
}

function Info({ label, value }) {
  return (
    <div className="info">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return "Não informado";
  return new Date(value).toLocaleString("pt-BR");
}

function shortName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(" ") || "Participante";
}

function paymentStatusLabel(value) {
  const labels = {
    approved: "Aprovado",
    pending: "Pendente",
    in_process: "Em analise",
    authorized: "Autorizado",
    rejected: "Rejeitado",
    cancelled: "Cancelado",
    refunded: "Estornado",
    charged_back: "Contestacao",
    in_mediation: "Em mediacao",
    manual: "Baixa manual"
  };
  return labels[value] || value || "Nao informado";
}

function paymentStatusDetailLabel(value) {
  const labels = {
    accredited: "Valor creditado",
    pending_contingency: "Aguardando processamento",
    pending_review_manual: "Aguardando revisao manual",
    cc_rejected_bad_filled_card_number: "Cartao preenchido incorretamente",
    cc_rejected_bad_filled_date: "Data do cartao incorreta",
    cc_rejected_bad_filled_security_code: "Codigo de seguranca incorreto",
    cc_rejected_blacklist: "Pagamento recusado",
    cc_rejected_call_for_authorize: "Precisa autorizar com o banco",
    cc_rejected_card_disabled: "Cartao desativado",
    cc_rejected_duplicated_payment: "Pagamento duplicado",
    cc_rejected_high_risk: "Recusado por risco",
    cc_rejected_insufficient_amount: "Saldo insuficiente",
    cc_rejected_invalid_installments: "Parcelamento invalido",
    cc_rejected_max_attempts: "Limite de tentativas excedido",
    cc_rejected_other_reason: "Recusado pelo cartao",
    refunded: "Valor devolvido",
    by_admin: "Devolvido pelo administrador",
    settled: "Valor reembolsado ao comprador",
    reimbursed: "Valor disponibilizado ao vendedor",
    in_process: "Em processamento"
  };
  return labels[value] || value || "";
}

function isTicketPaid(ticket) {
  if (ticket.mercadoPagoStatus === "manual") return ticket.status === "confirmed";
  if (ticket.mercadoPagoStatus) return ticket.mercadoPagoStatus === "approved";
  return ticket.status === "confirmed";
}

function isTicketWaitingPayment(ticket) {
  return !ticket.mercadoPagoStatus || ["pending", "in_process", "authorized"].includes(ticket.mercadoPagoStatus);
}

function ticketStatusPill(ticket) {
  if (isTicketPaid(ticket)) return { className: "confirmed", label: "Pago" };
  if (ticket.mercadoPagoStatus === "refunded") return { className: "refunded", label: "Estornado" };
  if (ticket.mercadoPagoStatus === "charged_back") return { className: "charged_back", label: "Contestacao" };
  if (ticket.mercadoPagoStatus === "cancelled") return { className: "cancelled", label: "Cancelado" };
  if (ticket.mercadoPagoStatus === "rejected") return { className: "rejected", label: "Rejeitado" };
  if (ticket.mercadoPagoStatus === "in_mediation") return { className: "in_mediation", label: "Mediacao" };
  return { className: "pending", label: isTicketWaitingPayment(ticket) ? "Aguardando" : "Nao pago" };
}
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapePdfText(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

async function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function createTicketImage(ticket) {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 1250;
  const ctx = canvas.getContext("2d");
  const qr = await imageFromDataUrl(ticket.qrCode);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#071b33";
  ctx.font = "700 42px Arial";
  ctx.fillText("EJD - credenciamento", 70, 100);
  ctx.font = "700 58px Arial";
  ctx.fillText("Encontrão 25 Anos", 70, 180);
  ctx.fillStyle = "#64748b";
  ctx.font = "700 30px Arial";
  ctx.fillText("Campina Grande - PB", 70, 235);

  ctx.strokeStyle = "#dbe4ee";
  ctx.lineWidth = 3;
  ctx.strokeRect(55, 285, 790, 870);

  ctx.fillStyle = "#071b33";
  ctx.font = "700 32px Arial";
  ctx.fillText("Participante", 90, 350);
  ctx.font = "700 44px Arial";
  ctx.fillText(shortName(ticket.participantName), 90, 410);

  ctx.font = "700 32px Arial";
  ctx.fillText("Código", 90, 500);
  ctx.font = "700 54px Arial";
  ctx.fillText(ticket.code, 90, 570);

  ctx.drawImage(qr, 190, 635, 520, 520);
  return canvas.toDataURL("image/png");
}

function createTicketPdf(ticket, ticketImage) {
  const jpegImage = document.createElement("canvas");
  jpegImage.width = 900;
  jpegImage.height = 1250;
  const ctx = jpegImage.getContext("2d");
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, jpegImage.width, jpegImage.height);
      ctx.drawImage(image, 0, 0);
      const jpg = jpegImage.toDataURL("image/jpeg", 0.92);
      const imageBytes = dataUrlToBytes(jpg);
      const encoder = new TextEncoder();
      const chunks = [];
      let length = 0;
      const pushText = (text) => {
        const bytes = encoder.encode(text);
        chunks.push(bytes);
        length += bytes.length;
      };
      const pushBytes = (bytes) => {
        chunks.push(bytes);
        length += bytes.length;
      };
      const objects = [];
      const add = (chunksForObject) => {
        objects.push(chunksForObject);
        return objects.length;
      };
      const imageObj = add([
        `<< /Type /XObject /Subtype /Image /Width 900 /Height 1250 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`,
        imageBytes,
        "\nendstream"
      ]);
      const content = `q\n432 0 0 600 90 120 cm\n/Im0 Do\nQ\nBT /F1 14 Tf 90 735 Td (${escapePdfText(shortName(ticket.participantName))}) Tj ET\n`;
      const contentObj = add([`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`]);
      const pageObj = add([`<< /Type /Page /Parent 4 0 R /Resources << /XObject << /Im0 ${imageObj} 0 R >> /Font << /F1 5 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R >>`]);
      add([`<< /Type /Pages /Kids [${pageObj} 0 R] /Count 1 >>`]);
      add(["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]);
      add(["<< /Type /Catalog /Pages 4 0 R >>"]);

      pushText("%PDF-1.4\n");
      const offsets = [0];
      for (let i = 0; i < objects.length; i += 1) {
        offsets.push(length);
        pushText(`${i + 1} 0 obj\n`);
        for (const part of objects[i]) {
          if (typeof part === "string") pushText(part);
          else pushBytes(part);
        }
        pushText("\nendobj\n");
      }
      const xref = length;
      pushText(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
      for (let i = 1; i < offsets.length; i += 1) pushText(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
      pushText(`trailer << /Size ${objects.length + 1} /Root 6 0 R >>\nstartxref\n${xref}\n%%EOF`);
      resolve(new Blob(chunks, { type: "application/pdf" }));
    };
    image.onerror = reject;
    image.src = ticketImage;
  });
}

async function downloadTicket(ticket) {
  if (!ticket.qrCode) return;
  const ticketImage = await createTicketImage(ticket);
  const filename = `ingresso-${ticket.code}`;

  if (isMobileDevice()) {
    const imageBlob = await (await fetch(ticketImage)).blob();
    const file = new File([imageBlob], `${filename}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Ingresso EJD", text: "Ingresso Encontrão 25 Anos" });
      return;
    }
    downloadBlob(imageBlob, `${filename}.png`);
    return;
  }

  const pdf = await createTicketPdf(ticket, ticketImage);
  downloadBlob(pdf, `${filename}.pdf`);
}

function BuyTicket({ refresh }) {
  const [config, setConfig] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [pixModal, setPixModal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const unitPrice = Number(config?.settings?.ticketPrice || 0);
  const subtotal = unitPrice * quantity;
  const serviceFeeRate = paymentMethod === "credit_card" ? 0.08 : 0.01;
  const serviceFee = subtotal * serviceFeeRate;
  const total = subtotal + serviceFee;

  useEffect(() => {
    api("/api/config").then(setConfig).catch((error) => setNotice({ type: "error", text: error.message }));
  }, []);

  async function checkout() {
    setLoading(true);
    setNotice(null);
    try {
      const data = await api("/api/tickets/checkout", {
        method: "POST",
        body: JSON.stringify({ quantity, paymentMethod })
      });
      await refresh();
      if (data.pix?.qrCode) {
        setPixModal(data.pix);
        setNotice({ type: "success", text: "Pix gerado. Aguarde a confirmação do pagamento." });
      } else if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      } else {
        setNotice({ type: "alert", text: `${data.quantity || quantity} ingresso(s) criado(s). Aguarde a confirmação do pagamento.` });
      }
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <h2>Comprar ingressos</h2>
      <Notice notice={notice} />
      <div className="checkout">
        <div className="checkout-info">
          <div className="price-summary">
            <div>
              <span>Ingresso</span>
              <strong>R$ {unitPrice.toFixed(2).replace(".", ",")}</strong>
            </div>
            <div>
              <span>Subtotal</span>
              <strong>R$ {subtotal.toFixed(2).replace(".", ",")}</strong>
            </div>
            <div>
              <span>Taxa de Serviço Web</span>
              <strong>R$ {serviceFee.toFixed(2).replace(".", ",")}</strong>
            </div>
            <div className="price-total">
              <span>Total</span>
              <strong>R$ {total.toFixed(2).replace(".", ",")}</strong>
            </div>
          </div>
          <label className="quantity-field">
            Quantidade
            <input type="number" min="1" max="20" value={quantity} onChange={(e) => setQuantity(Math.min(Math.max(Number(e.target.value) || 1, 1), 20))} />
          </label>
          <fieldset className="payment-options">
            <legend>Pagamento</legend>
            <label>
              <input type="radio" name="paymentMethod" value="pix" checked={paymentMethod === "pix"} onChange={(e) => setPaymentMethod(e.target.value)} />
              Pix
            </label>
            <label>
              <input type="radio" name="paymentMethod" value="credit_card" checked={paymentMethod === "credit_card"} onChange={(e) => setPaymentMethod(e.target.value)} />
              Cartão de crédito
            </label>
          </fieldset>
        </div>
        <button className="primary" disabled={loading} onClick={checkout}>
          {loading ? "Abrindo pagamento..." : "Pagar"}
        </button>
      </div>
      <div className="fee-notes">
        <p>* Pix: taxa de serviço de 1%.</p>
        <p>** Cartão de crédito: taxa de serviço de 8%.</p>
      </div>
      {pixModal && <PixModal pix={pixModal} onClose={() => setPixModal(null)} />}
    </section>
  );
}

function PixModal({ pix, onClose }) {
  const [copied, setCopied] = useState(false);

  async function copyPix() {
    await navigator.clipboard.writeText(pix.qrCode);
    setCopied(true);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <h3>Pagamento Pix</h3>
          <button className="ghost icon-button" onClick={onClose} aria-label="Fechar">X</button>
        </div>
        {pix.qrCodeBase64 && <img className="pix-qr" src={`data:image/png;base64,${pix.qrCodeBase64}`} alt="QR Code Pix" />}
        <label>
          Pix copia e cola
          <textarea readOnly value={pix.qrCode} />
        </label>
        <div className="modal-actions">
          <button className="primary" onClick={copyPix}>{copied ? "Copiado" : "Copiar Pix"}</button>
          {pix.ticketUrl && <a className="secondary" href={pix.ticketUrl} target="_blank" rel="noreferrer">Abrir Pix</a>}
        </div>
      </div>
    </div>
  );
}

function PaymentConfirmedModal({ onClose, onOpenTickets }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal confirm-modal">
        <div className="modal-head">
          <h3>Pagamento confirmado</h3>
          <button className="ghost icon-button" onClick={onClose} aria-label="Fechar">X</button>
        </div>
        <p>Pagamento confirmado. Confira seus ingressos na aba Meus Ingressos.</p>
        <div className="modal-actions">
          <button className="primary" onClick={onOpenTickets}>Meus Ingressos</button>
          <button className="secondary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function MyTickets({ tickets }) {
  const [selectedTicket, setSelectedTicket] = useState(null);
  const confirmed = tickets.filter(isTicketPaid);
  return (
    <section className="panel">
      <h2>Meus ingressos</h2>
      <div className="ticket-list">
        {confirmed.map((ticket) => {
          const text = encodeURIComponent(`Meu ingresso do Encontrão 25 Anos: ${ticket.code}`);
          return (
            <article className="ticket" key={ticket.id} role="button" tabIndex="0" onClick={() => setSelectedTicket(ticket)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedTicket(ticket); }}>
              <div>
                <strong>{shortName(ticket.participantName)}</strong>
              </div>
              <div className="ticket-code">
                <span>{ticket.checkinAt ? "QRcode ja foi utilizado" : "Código"}</span>
                <strong>{ticket.code}</strong>
              </div>
              {ticket.qrCode && (
                <div className={`qr-wrap ${ticket.checkinAt ? "used" : ""}`}>
                  <img src={ticket.qrCode} alt={`QR Code ${ticket.code}`} />
                  {ticket.checkinAt && <span className="qr-used-mark">X</span>}
                </div>
              )}
              <div className="ticket-actions">
                <a className="secondary" href={`https://wa.me/?text=${text}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>WhatsApp</a>
                <button className="secondary" onClick={(event) => { event.stopPropagation(); downloadTicket(ticket); }}>Baixar</button>
              </div>
            </article>
          );
        })}
      </div>
      {selectedTicket && <TicketModal ticket={selectedTicket} onClose={() => setSelectedTicket(null)} />}
    </section>
  );
}

function TicketModal({ ticket, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal ticket-modal">
        <div className="modal-head">
          <h3>{shortName(ticket.participantName)}</h3>
          <button className="ghost icon-button" onClick={onClose} aria-label="Fechar">X</button>
        </div>
        <div className="ticket-modal-code">
          <span>{ticket.checkinAt ? "QRcode ja foi utilizado" : "Código"}</span>
          <strong>{ticket.code}</strong>
        </div>
        {ticket.qrCode && (
          <div className={`qr-wrap modal-qr-wrap ${ticket.checkinAt ? "used" : ""}`}>
            <img className="ticket-qr-large" src={ticket.qrCode} alt={`QR Code ${ticket.code}`} />
            {ticket.checkinAt && <span className="qr-used-mark">X</span>}
          </div>
        )}
        <div className="modal-actions">
          <button className="primary" onClick={() => downloadTicket(ticket)}>Baixar</button>
          <button className="secondary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function CheckinPanel() {
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState(null);
  const [scanning, setScanning] = useState(false);
  const readerRef = useRef(null);
  const qrRef = useRef(null);

  async function validate(input) {
    try {
      const data = await api("/api/checkin/validate", {
        method: "POST",
        body: JSON.stringify({ value: input || value })
      });
      setNotice({ type: "success", text: data.message });
      setValue("");
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function startCamera() {
    setNotice(null);
    setScanning(true);
    setTimeout(async () => {
      try {
        qrRef.current = new Html5Qrcode("qr-reader");
        await qrRef.current.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          async (decoded) => {
            await stopCamera();
            await validate(decoded);
          }
        );
      } catch (error) {
        setScanning(false);
        setNotice({ type: "error", text: "Não foi possível abrir a câmera." });
      }
    }, 50);
  }

  async function stopCamera() {
    if (qrRef.current) {
      await qrRef.current.stop().catch(() => {});
      qrRef.current.clear();
      qrRef.current = null;
    }
    setScanning(false);
  }

  useEffect(() => () => { stopCamera(); }, []);

  return (
    <section className="panel">
      <h2>Acessar painel de check-in</h2>
      <Notice notice={notice} />
      <div className="scanner">
        {scanning && <div id="qr-reader" ref={readerRef}></div>}
        <div className="actions">
          {!scanning ? <button className="primary" onClick={startCamera}>Ler QR Code</button> : <button className="secondary" onClick={stopCamera}>Parar câmera</button>}
        </div>
      </div>
      <form className="manual" onSubmit={(event) => { event.preventDefault(); validate(); }}>
        <label>
          Código ou telefone
          <input value={value} onChange={(e) => setValue(e.target.value)} required />
        </label>
        <button className="primary">Validar</button>
      </form>
    </section>
  );
}

function AdminPanel({ refresh }) {
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);
  const [users, setUsers] = useState([]);
  const [notice, setNotice] = useState(null);

  async function load() {
    const [config, summaryData, userData] = await Promise.all([
      api("/api/config"),
      api("/api/admin/summary"),
      api("/api/admin/users")
    ]);
    setSettings(config.settings);
    setSummary(summaryData);
    setUsers(userData.users);
  }

  useEffect(() => {
    load().catch((error) => setNotice({ type: "error", text: error.message }));
  }, []);

  async function saveSettings(event) {
    event.preventDefault();
    try {
      const data = await api("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify(settings)
      });
      setSettings(data.settings);
      setNotice({ type: "success", text: "Ingresso atualizado." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function updateRole(userId, role) {
    try {
      await api(`/api/admin/users/${userId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role })
      });
      await load();
      await refresh();
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function confirmTicket(ticketId) {
    try {
      await api(`/api/admin/tickets/${ticketId}/confirm`, { method: "POST", body: "{}" });
      await load();
      setNotice({ type: "success", text: "Pagamento confirmado." });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  return (
    <>
      <section className="panel">
        <h2>Ingresso</h2>
        <Notice notice={notice} />
        {settings && (
          <form className="admin-form" onSubmit={saveSettings}>
            <label>
              Valor
              <input type="number" min="0" step="0.01" value={settings.ticketPrice} onChange={(e) => setSettings({ ...settings, ticketPrice: e.target.value })} />
            </label>
            <label className="toggle">
              <input type="checkbox" checked={settings.registrationOpen} onChange={(e) => setSettings({ ...settings, registrationOpen: e.target.checked })} />
              Cadastro aberto
            </label>
            <button className="primary">Salvar</button>
          </form>
        )}
      </section>

      <section className="panel">
        <h2>Painel administrativo</h2>
        {summary && (
          <>
            <div className="stats">
              <Info label="Pagos" value={summary.paid} />
              <Info label="Aguardando" value={summary.pending} />
              <Info label="Presentes" value={summary.present} />
              <Info label="Usuários" value={summary.users} />
            </div>
            <div className="table">
              {summary.tickets.map((ticket) => {
                const pill = ticketStatusPill(ticket);
                const statusDetail = paymentStatusDetailLabel(ticket.mercadoPagoStatusDetail);
                return (
                  <div className="row" key={ticket.id}>
                    <div>
                      <strong>{ticket.participantName}</strong>
                      <small>{ticket.participantWhatsapp}</small>
                    </div>
                    <div>
                      <span>Status Mercado Pago</span>
                      <strong>{paymentStatusLabel(ticket.mercadoPagoStatus)}</strong>
                      {statusDetail && <small>{statusDetail}</small>}
                    </div>
                    <div>
                      <span>Baixa</span>
                      <strong>{isTicketPaid(ticket) ? formatDateTime(ticket.paidAt || ticket.confirmedAt) : "Nao se aplica"}</strong>
                    </div>
                    <div>
                      <span>Baixa manual por</span>
                      <strong>{ticket.manualConfirmedByName || "Nao se aplica"}</strong>
                    </div>
                    <span className={`pill ${pill.className}`}>{pill.label}</span>
                    {isTicketPaid(ticket) ? <span>{ticket.checkinAt ? "Presente" : "Nao presente"}</span> : <button className="mini" onClick={() => confirmTicket(ticket.id)}>Confirmar</button>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Usuários</h2>
        <div className="user-cards">
          {users.map((user) => (
            <article className="user-card" key={user.id}>
              <strong>{user.name}</strong>
              <span>{user.whatsapp}</span>
              <select value={user.role} onChange={(e) => updateRole(user.id, e.target.value)}>
                <option value="usuarios">usuarios</option>
                <option value="checkin">Check-in</option>
                <option value="admin">Área exclusiva</option>
              </select>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [active, setActive] = useState("profile");
  const [paymentConfirmedModal, setPaymentConfirmedModal] = useState(false);
  const [loading, setLoading] = useState(true);

  function detectConfirmedPayment(nextTickets) {
    const seen = JSON.parse(localStorage.getItem(confirmedPaymentSeenKey) || "[]");
    const seenSet = new Set(seen);
    const confirmed = nextTickets.find((ticket) => {
      const key = ticket.orderId || ticket.id;
      return isTicketPaid(ticket) && ticket.mercadoPagoStatus === "approved" && !seenSet.has(key);
    });
    if (!confirmed) return;
    const key = confirmed.orderId || confirmed.id;
    seenSet.add(key);
    localStorage.setItem(confirmedPaymentSeenKey, JSON.stringify([...seenSet]));
    setPaymentConfirmedModal(true);
  }

  async function refresh() {
    const data = await api("/api/me");
    setUser(data.user);
    setTickets(data.tickets || []);
    detectConfirmedPayment(data.tickets || []);
    return data;
  }

  useEffect(() => {
    if (!localStorage.getItem(tokenKey)) {
      setLoading(false);
      return;
    }
    refresh().catch(() => localStorage.removeItem(tokenKey)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [user?.id]);

  async function logout() {
    await api("/api/logout", { method: "POST", body: "{}" }).catch(() => {});
    localStorage.removeItem(tokenKey);
    setUser(null);
    setTickets([]);
    setPaymentConfirmedModal(false);
  }

  const tabs = useMemo(() => {
    if (!user) return [];
    const items = [{ id: "profile", label: "Meu perfil" }];
    if (["usuarios", "participant"].includes(user.role)) items.push({ id: "buy", label: "Comprar ingressos" });
    if (tickets.some(isTicketPaid)) items.push({ id: "tickets", label: "Meus ingressos" });
    if (["checkin", "admin"].includes(user.role)) items.push({ id: "checkin", label: "Acessar painel de check-in" });
    if (user.role === "admin") items.push({ id: "admin", label: "Área exclusiva" });
    return items;
  }, [user, tickets]);

  useEffect(() => {
    if (tabs.length && !tabs.find((tab) => tab.id === active)) setActive(tabs[0].id);
  }, [tabs, active]);

  if (loading) return <div className="loading">Carregando...</div>;
  if (!user) return <AuthScreen onAuth={(nextUser) => { setUser(nextUser); refresh(); }} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span>EJD - credenciamento</span>
          <strong>Encontrão 25 Anos</strong>
        </div>
        <button className="ghost" onClick={logout}>Sair</button>
      </header>
      <nav className="nav-tabs">
        {tabs.map((tab) => <button key={tab.id} className={active === tab.id ? "active" : ""} onClick={() => setActive(tab.id)}>{tab.label}</button>)}
      </nav>
      {active === "profile" && <Profile user={user} />}
      {active === "buy" && <BuyTicket refresh={refresh} />}
      {active === "tickets" && <MyTickets tickets={tickets} />}
      {active === "checkin" && <CheckinPanel />}
      {active === "admin" && <AdminPanel refresh={refresh} />}
      {paymentConfirmedModal && (
        <PaymentConfirmedModal
          onClose={() => setPaymentConfirmedModal(false)}
          onOpenTickets={() => {
            setPaymentConfirmedModal(false);
            setActive("tickets");
          }}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
