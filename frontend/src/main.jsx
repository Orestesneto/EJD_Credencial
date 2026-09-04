import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Html5Qrcode } from "html5-qrcode";
import "./styles.css";

const tokenKey = "ejd_token";
const confirmedPaymentSeenKey = "ejd_confirmed_payment_seen";
const saleLotPricePresets = {
  relampago: { ticketPrice: "60", socialTicketPrice: "40" },
  lote2: { ticketPrice: "80", socialTicketPrice: "50" },
  lote3: { ticketPrice: "100", socialTicketPrice: "60" }
};
const roles = {
  usuarios: "usuarios",
  participant: "usuarios",
  checkin: "Check-in",
  admin: "Área exclusiva"
};

function digits(value) {
  return String(value || "").replace(/\D/g, "");
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

function AnniversaryMark({ compact = false, inverse = false }) {
  return (
    <div className={`event-brand ${compact ? "compact" : ""}`} aria-label="Encontrão EJD 25 anos — Trilhos e Destinos">
      <img src="/branding/25-anos-ejd.png" alt="25 Anos EJD" />
      {!compact && <div className="event-brand-copy"><span>ENCONTRÃO EJD 25 ANOS</span><strong>TRILHOS<br />E DESTINOS</strong></div>}
    </div>
  );
}

function BrandMark ({ compact = false }) {
  return (
    <div className={`anniversary-brand ${compact ? "compact" : ""}`} aria-label="25 Anos Encontro de Jovens com Deus">
      <img className="event-brand-icon" src="/branding/trilhos-destinos.png" alt="Trilhos e Destinos" />
      
      {!compact && <span>25 anos<br />EJD</span>}
    </div>
  );
}

function BrandLockup({ compact = false, inverse = false }) {
  return <div className={`brand-lockup ${compact ? "compact" : ""} ${inverse ? "inverse" : ""}`}><BrandMark compact={compact} inverse={inverse} /><i aria-hidden="true" /><AnniversaryMark compact={compact} /></div>;
}

function TopbarLogo() {
  return (
    <div className="topbar-logos">
      <img className="topbar-logo" src="/branding/monocromatica-azul.png" alt="Trilhos e Destinos" />
      <img className="topbar-anniversary-logo" src="/branding/25-anos-ejd.png" alt="25 Anos EJD" />
    </div>
  );
}

function AuthScreen({ onAuth }) {
  const [tab, setTab] = useState("login");
  const [notice, setNotice] = useState(null);
  const [login, setLogin] = useState({ email: "", birthDate: "" });
  const [form, setForm] = useState({ name: "", email: "", whatsapp: "", birthDate: "" });

  async function submitLogin(event) {
    event.preventDefault();
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ email: login.email.trim().toLowerCase(), birthDate: digits(login.birthDate) })
      });
      localStorage.setItem(tokenKey, data.token);
      onAuth(data.user);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function submitRegister(event) {
    event.preventDefault();
    try {
      const data = await api("/api/register", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          email: form.email.trim().toLowerCase(),
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
      <div className="auth-rail" aria-hidden="true">
        <BrandMark />
             </div>
      <section className="auth-panel">
        <div className="brand auth-brand">
          <AnniversaryMark />
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
              E-mail
              <input type="email" autoComplete="email" value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} required />
            </label>
            <label>
              Data de nascimento
              <input inputMode="numeric" autoComplete="bday" maxLength="8" placeholder="ddmmaaaa" value={login.birthDate} onChange={(e) => setLogin({ ...login, birthDate: digits(e.target.value).slice(0, 8) })} required />
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
              E-mail
              <input type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
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
        <Info label="E-mail" value={user.email} />
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

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function shortName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).join(" ") || "Participante";
}

const socialTicketMessage = "Ingressos do tipo Social exigem a doação de 1 kg de alimento não perecível, que deverá ser entregue na entrada do evento.";
const meiaTicketMessage = "O Participante deverá apressentar  o comprovante que tem direito a meia entrada";

const meiaTicketNotice = "Para ingressos de meia-entrada, poderá ser solicitada, na entrada do evento, a apresentação do documento comprovatório.";

function ticketTypeLabel(ticketType) {
  if (ticketType === "social") return "INGRESSO SOCIAL";
  if (ticketType === "meia") return "INGRESSO MEIO";
  return "INGRESSO INTEIRA";
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(" ");
  let line = "";
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, y);
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
    pending_waiting_payment: "Aguardando pagamento",
    pending_waiting_transfer: "Aguardando transferência Pix",
    pending_challenge: "Aguardando autenticação do banco",
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
    cc_rejected_3ds_challenge: "Autenticação do banco não concluída",
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
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(80, 455, 420, 70);
  ctx.fillStyle = "#071b33";
  ctx.font = "700 32px Arial";
  ctx.fillText("Tipo do bilhete", 90, 485);
  ctx.font = "700 40px Arial";
  ctx.fillText(ticketTypeLabel(ticket.ticketType), 90, 545);
  ctx.font = "700 32px Arial";
  ctx.fillText("CÃ³digo", 90, 625);
  ctx.font = "700 54px Arial";
  ctx.fillText(ticket.code, 90, 695);

  ctx.drawImage(qr, 245, 720, 410, 410);
  if (ticket.ticketType === "social") {
    ctx.fillStyle = "#071b33";
    ctx.font = "700 24px Arial";
    wrapCanvasText(ctx, socialTicketMessage, 90, 1170, 720, 26);
  }
  if (ticket.ticketType === "meia") {
    ctx.fillStyle = "#071b33";
    ctx.font = "700 24px Arial";
    wrapCanvasText(ctx, meiaTicketNotice, 90, 1170, 720, 26);
  }
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
  const checkoutRequestIdRef = useRef("");
  const checkoutInFlightRef = useRef(false);
  const [config, setConfig] = useState(null);
  const [ticketQuantities, setTicketQuantities] = useState({ inteiro: 0, meia: 0, social: 0 });
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [pixModal, setPixModal] = useState(null);
  const [cardModal, setCardModal] = useState(false);
  const [cardError, setCardError] = useState("");
  const [cardChallenge, setCardChallenge] = useState(null);
  const [ticketLotsModal, setTicketLotsModal] = useState(true);
  const [socialTicketModal, setSocialTicketModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const unitPrice = Number(config?.settings?.ticketPrice || 0);
  const socialUnitPrice = Number(config?.settings?.socialTicketPrice ?? unitPrice);
  const ticketTypeOptions = [
    { value: "inteiro", label: "Inteiro", discount: 0 },
    { value: "meia", label: "Meia", discount: 0.5 },
    { value: "social", label: "Social" }
  ];
  const ticketTypePrices = {
    inteiro: unitPrice,
    meia: unitPrice * 0.5,
    social: socialUnitPrice
  };
  const quantity = Object.values(ticketQuantities).reduce((sum, value) => sum + value, 0);
  const subtotal = ticketTypeOptions.reduce((sum, option) => sum + ticketTypePrices[option.value] * ticketQuantities[option.value], 0);
  const serviceFeeRate = paymentMethod === "credit_card" ? 0.08 : 0.01;
  const serviceFee = subtotal * serviceFeeRate;
  const total = subtotal + serviceFee;

  useEffect(() => {
    api("/api/config").then(setConfig).catch((error) => setNotice({ type: "error", text: error.message }));
  }, []);

  function updateTicketQuantity(ticketType, value) {
    const parsed = Math.max(Number.parseInt(value, 10) || 0, 0);
    const otherQuantity = Object.entries(ticketQuantities).reduce((sum, [type, amount]) => type === ticketType ? sum : sum + amount, 0);
    const next = Math.min(parsed, Math.max(20 - otherQuantity, 0));
    setTicketQuantities({ ...ticketQuantities, [ticketType]: next });
  }

  function handlePayClick() {
    if (quantity <= 0) {
      setNotice({ type: "error", text: "Selecione pelo menos 1 ingresso." });
      return;
    }
    if (ticketQuantities.social > 0) {
      setSocialTicketModal(true);
      return;
    }
    beginCheckout();
  }

  function confirmSocialTicket() {
    setSocialTicketModal(false);
    beginCheckout();
  }

  function beginCheckout() {
    if (paymentMethod === "credit_card") {
      setCardError("");
      setCardModal(true);
      return;
    }
    checkout();
  }

  async function checkout(cardPayment = null) {
    if (checkoutInFlightRef.current) return;
    checkoutInFlightRef.current = true;
    if (!checkoutRequestIdRef.current) {
      checkoutRequestIdRef.current = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    setLoading(true);
    setNotice(null);
    setCardError("");
    try {
      const data = await api("/api/tickets/checkout", {
        method: "POST",
        body: JSON.stringify({
          items: ticketQuantities,
          paymentMethod,
          cardPayment,
          checkoutRequestId: checkoutRequestIdRef.current
        })
      });
      checkoutRequestIdRef.current = "";
      await refresh();
      if (data.pix?.qrCode) {
        setPixModal(data.pix);
        setNotice({ type: "success", text: "Pix gerado. Aguarde a confirmação do pagamento." });
      } else if (data.cardPayment) {
        setCardModal(false);
        const detail = paymentStatusDetailLabel(data.cardPayment.statusDetail);
        if (data.cardPayment.status === "pending" && data.cardPayment.statusDetail === "pending_challenge" && data.cardPayment.threeDSInfo?.externalResourceUrl && data.cardPayment.threeDSInfo?.creq) {
          setCardChallenge({ paymentId: data.cardPayment.id, ...data.cardPayment.threeDSInfo });
          setNotice({ type: "alert", text: "Confirme sua identidade na tela do banco para concluir o pagamento." });
          return;
        }
        setNotice({
          type: data.cardPayment.status === "approved" ? "success" : "alert",
          text: data.cardPayment.status === "approved"
            ? "Pagamento aprovado. Seus ingressos já estão disponíveis."
            : `Pagamento ${paymentStatusLabel(data.cardPayment.status).toLowerCase()}${detail ? `: ${detail}` : "."}`
        });
      } else {
        setNotice({ type: "alert", text: `${data.quantity || quantity} ingresso(s) criado(s). Aguarde a confirmação do pagamento.` });
      }
    } catch (error) {
      if (cardPayment) setCardError(error.message);
      else setNotice({ type: "error", text: error.message });
    } finally {
      checkoutInFlightRef.current = false;
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
              <span>Ingressos</span>
              <strong>{quantity}</strong>
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
          <fieldset className="ticket-type-options">
            <legend>Tipo de ingresso</legend>
            {ticketTypeOptions.map((option) => (
              <div className="ticket-type-row" key={option.value}>
                <div>
                  <strong>{option.label}</strong>
                  <span>R$ {ticketTypePrices[option.value].toFixed(2).replace(".", ",")}</span>
                </div>
                <div className="quantity-control compact">
                  <button type="button" className="quantity-button" onClick={() => updateTicketQuantity(option.value, ticketQuantities[option.value] - 1)} disabled={ticketQuantities[option.value] <= 0}>-</button>
                  <input inputMode="numeric" pattern="[0-9]*" value={ticketQuantities[option.value]} onChange={(e) => updateTicketQuantity(option.value, e.target.value)} aria-label={`Quantidade de ingressos ${option.label}`} />
                  <button type="button" className="quantity-button" onClick={() => updateTicketQuantity(option.value, ticketQuantities[option.value] + 1)} disabled={quantity >= 20}>+</button>
                </div>
              </div>
            ))}
          </fieldset>
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
        <button className="primary" disabled={loading} onClick={handlePayClick}>
          {loading ? "Abrindo pagamento..." : "Pagar"}
        </button>
      </div>
      <div className="fee-notes">
        <p>* Pix: taxa de serviço de 1%.</p>
        <p>** Cartão de crédito: taxa de serviço de 8%.</p>
        <p>*** {meiaTicketNotice}</p>
      </div>
      {ticketLotsModal && <TicketLotsModal currentSaleLot={config?.settings?.currentSaleLot} onClose={() => setTicketLotsModal(false)} />}
      {socialTicketModal && <SocialTicketModal onConfirm={confirmSocialTicket} onClose={() => setSocialTicketModal(false)} />}
      {pixModal && <PixModal pix={pixModal} onClose={() => setPixModal(null)} />}
      {cardModal && <CardPaymentModal publicKey={config?.mercadoPagoPublicKey} total={total} loading={loading} error={cardError} onSubmit={checkout} onClose={() => !loading && setCardModal(false)} />}
      {cardChallenge && <CardChallengeModal challenge={cardChallenge} onComplete={async () => {
        setCardChallenge(null);
        setNotice({ type: "alert", text: "Autenticação concluída. Estamos confirmando o pagamento com o banco." });
        await refresh();
      }} onClose={() => setCardChallenge(null)} />}
    </section>
  );
}

function TicketLotsModal({ currentSaleLot = "relampago", onClose }) {
  const lots = [
    { id: "relampago",
      name: "Lote Relâmpago",
      prices: [
        ["Inteira", "60,00"],
        ["Meia", "30,00"],
        ["Social", "40,00"]
      ]
    },
    { id: "lote2",
      name: "1° Lote",
      period: ["Início: 04/09 às 12:00", "Término: 01/10 às 11:59"],
      prices: [
        ["Inteira", "80,00"],
        ["Meia", "40,00"],
        ["Social", "50,00"]
      ]
    },
    { id: "lote3",
      name: "2° Lote",
      period: ["Início: 01/10 às 12:00", "Término: dia do encontro"],
      prices: [
        ["Inteira", "100,00"],
        ["Meia", "50,00"],
        ["Social", "60,00"]
      ]
    }
  ];
  const currentLotIndex = Math.max(lots.findIndex((lot) => lot.id === currentSaleLot), 0);

  function lotStatus(index) {
    if (index < currentLotIndex) return "Encerrado";
    if (index > currentLotIndex) return "Não iniciado";
    return "Em venda";
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal lots-modal">
        <div className="modal-head">
          <h3>Lotes de ingressos</h3>
          <button className="ghost icon-button" onClick={onClose} aria-label="Fechar">X</button>
        </div>
        <div className="lot-list">
          {lots.map((lot, index) => (
            <section className="lot-card" key={lot.name}>
              <div className="lot-card-head">
                <h4>{lot.name}</h4>
                <strong className={`lot-status ${index === currentLotIndex ? "active" : ""}`}>{lotStatus(index)}</strong>
              </div>
              {lot.period && (
                <div className="lot-period">
                  {lot.period.map((line) => <span key={line}>{line}</span>)}
                </div>
              )}
              <div className="lot-prices">
                {lot.prices.map(([label, price]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>R$ {price}</strong>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Continuar</button>
        </div>
      </div>
    </div>
  );
}

function SocialTicketModal({ onConfirm, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal confirm-modal">
        <div className="modal-head">
          <h3>Ingresso Social</h3>
          <button className="ghost icon-button" onClick={onClose} aria-label="Fechar">X</button>
        </div>
        <p>Ingressos do tipo Social exigem a doação de 1 kg de alimento não perecível, que deverá ser entregue na entrada do evento.</p>
        <div className="modal-actions">
          <button className="primary" onClick={onConfirm}>OK</button>
        </div>
      </div>
    </div>
  );
}

function CardPaymentModal({ publicKey, total, loading, error, onSubmit, onClose }) {
  const submitRef = useRef(onSubmit);
  const [sdkError, setSdkError] = useState("");

  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    if (!publicKey) {
      setSdkError("Configure MERCADO_PAGO_PUBLIC_KEY para aceitar cartão.");
      return undefined;
    }
    if (!window.MercadoPago) {
      setSdkError("Não foi possível carregar o formulário seguro do Mercado Pago.");
      return undefined;
    }

    const mercadoPago = new window.MercadoPago(publicKey, { locale: "pt-BR" });
    const cardForm = mercadoPago.cardForm({
      amount: Number(total).toFixed(2),
      iframe: true,
      form: {
        id: "card-payment-form",
        cardNumber: { id: "card-payment__cardNumber", placeholder: "Número do cartão" },
        expirationDate: { id: "card-payment__expirationDate", placeholder: "MM/AA" },
        securityCode: { id: "card-payment__securityCode", placeholder: "CVV" },
        cardholderName: { id: "card-payment__cardholderName", placeholder: "Nome como está no cartão" },
        issuer: { id: "card-payment__issuer", placeholder: "Banco emissor" },
        installments: { id: "card-payment__installments", placeholder: "Parcelas" },
        identificationType: { id: "card-payment__identificationType", placeholder: "Tipo de documento" },
        identificationNumber: { id: "card-payment__identificationNumber", placeholder: "CPF do titular" },
        cardholderEmail: { id: "card-payment__cardholderEmail", placeholder: "E-mail" }
      },
      callbacks: {
        onFormMounted: (mountError) => {
          if (mountError) setSdkError("Não foi possível abrir os campos seguros do cartão.");
        },
        onSubmit: async (event) => {
          event.preventDefault();
          setSdkError("");
          const formData = cardForm.getCardFormData();
          await submitRef.current({
            token: formData.token,
            deviceId: String(window.MP_DEVICE_SESSION_ID || "").trim(),
            cardholderName: formData.cardholderName,
            issuerId: formData.issuerId,
            paymentMethodId: formData.paymentMethodId,
            installments: Number(formData.installments),
            payer: {
              email: formData.cardholderEmail,
              identification: {
                type: formData.identificationType,
                number: formData.identificationNumber
              }
            }
          });
        },
        onFetching: () => {
          setSdkError("");
        }
      }
    });

    return () => {
      try {
        cardForm.unmount?.();
      } catch {
        // O SDK remove os campos seguros quando o modal sai do DOM.
      }
    };
  }, [publicKey, total]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="card-payment-title">
      <div className="modal card-payment-modal">
        <div className="modal-head">
          <div className="card-payment-heading">
            <h3 id="card-payment-title">Pagamento com cartão</h3>
            <span>Preencha os dados abaixo para finalizar sua compra</span>
          </div>
          <button type="button" className="ghost icon-button" onClick={onClose} disabled={loading} aria-label="Fechar">X</button>
        </div>
        <div className="card-payment-total">
          <span>Total da compra</span>
          <strong>{formatCurrency(total)}</strong>
        </div>
        {(sdkError || error) && <div className="notice error">{sdkError || error}</div>}
        <form id="card-payment-form" className="card-payment-form">
          <label className="card-field-wide">
            Número do cartão
            <div id="card-payment__cardNumber" className="mp-secure-field" />
          </label>
          <label>
            Validade
            <div id="card-payment__expirationDate" className="mp-secure-field" />
          </label>
          <label>
            Código de segurança
            <div id="card-payment__securityCode" className="mp-secure-field" />
          </label>
          <label className="card-field-wide">
            Nome do titular
            <input id="card-payment__cardholderName" autoComplete="cc-name" />
          </label>
          <label>
            Documento
            <select id="card-payment__identificationType" />
          </label>
          <label>
            Número do documento
            <input id="card-payment__identificationNumber" inputMode="numeric" autoComplete="off" />
          </label>
          <label>
            Banco emissor
            <select id="card-payment__issuer" />
          </label>
          <label>
            Parcelas
            <select id="card-payment__installments" />
          </label>
          <label className="card-field-wide">
            E-mail
            <input id="card-payment__cardholderEmail" type="email" autoComplete="email" />
          </label>
          <div className="modal-actions card-field-wide">
            <button type="submit" className="primary" disabled={loading || Boolean(sdkError)}>{loading ? "Processando..." : `Pagar ${formatCurrency(total)}`}</button>
            <button type="button" className="secondary" onClick={onClose} disabled={loading}>Cancelar</button>
          </div>
        </form>
        <small className="card-security-note">Os dados do cartão são protegidos e tokenizados diretamente pelo Mercado Pago.</small>
      </div>
    </div>
  );
}

function CardChallengeModal({ challenge, onComplete, onClose }) {
  const iframeRef = useRef(null);
  const completeRef = useRef(onComplete);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !challenge.externalResourceUrl || !challenge.creq) return undefined;
    const frameDocument = iframe.contentWindow?.document;
    if (!frameDocument) return undefined;
    const form = frameDocument.createElement("form");
    form.method = "POST";
    form.action = challenge.externalResourceUrl;
    const creq = frameDocument.createElement("input");
    creq.type = "hidden";
    creq.name = "creq";
    creq.value = challenge.creq;
    form.appendChild(creq);
    frameDocument.body.appendChild(form);
    form.submit();

    const handleMessage = (event) => {
      if (event.data?.status === "COMPLETE") completeRef.current();
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [challenge.externalResourceUrl, challenge.creq]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="card-challenge-title">
      <div className="modal card-challenge-modal">
        <div className="modal-head">
          <div>
            <h3 id="card-challenge-title">Confirme com seu banco</h3>
            <small>Conclua a autenticação abaixo para autorizar o pagamento.</small>
          </div>
          <button type="button" className="ghost icon-button" onClick={onClose} aria-label="Fechar">X</button>
        </div>
        <iframe ref={iframeRef} name="mercado-pago-3ds" title="Autenticação segura do banco" className="card-challenge-frame" />
      </div>
    </div>
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
  const [emailingTicketId, setEmailingTicketId] = useState(null);
  const [notice, setNotice] = useState(null);
  const confirmed = tickets.filter(isTicketPaid);

  async function resendEmail(ticket) {
    setEmailingTicketId(ticket.id);
    setNotice(null);
    try {
      const result = await api(`/api/tickets/${ticket.id}/email`, { method: "POST", body: "{}" });
      setNotice({ type: "success", text: result.message });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setEmailingTicketId(null);
    }
  }

  return (
    <section className="panel">
      <h2>Meus ingressos</h2>
      <Notice notice={notice} />
      <div className="ticket-list">
        {confirmed.map((ticket) => {
          return (
            <article className="ticket" key={ticket.id} role="button" tabIndex="0" onClick={() => setSelectedTicket(ticket)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedTicket(ticket); }}>
              <div className="ticket-branding" aria-label="Marcas do evento">
                <img src="/branding/monocromatica-azul.png" alt="Trilhos e Destinos" />
                <i aria-hidden="true" />
                <img src="/branding/25-anos-ejd.png" alt="25 Anos EJD" />
              </div>
              <div>
                <strong>{shortName(ticket.participantName)}</strong>
                <span className="ticket-type-label">{ticketTypeLabel(ticket.ticketType)}</span>
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
                <button className="secondary" onClick={(event) => { event.stopPropagation(); downloadTicket(ticket); }}>Baixar</button>
                <button className="secondary" disabled={Boolean(emailingTicketId)} onClick={(event) => { event.stopPropagation(); resendEmail(ticket); }}>
                  {emailingTicketId === ticket.id ? "Enviando..." : "Enviar por e-mail"}
                </button>
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
        <div className="ticket-branding ticket-modal-branding" aria-label="Marcas do evento">
          <img src="/branding/monocromatica-azul.png" alt="Trilhos e Destinos" />
          <i aria-hidden="true" />
          <img src="/branding/25-anos-ejd.png" alt="25 Anos EJD" />
        </div>
        <div className="ticket-modal-code">
          <span>Tipo do bilhete</span>
          <strong>{ticketTypeLabel(ticket.ticketType)}</strong>
        </div>
        {ticket.ticketType === "social" && <p className="ticket-social-message">{socialTicketMessage}</p>}
        {ticket.ticketType === "meia" && <p className="ticket-social-message">{meiaTicketNotice}</p>}
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

function SocialCheckinModal({ ticket, onConfirm, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal confirm-modal">
        <div className="modal-head">
          <h3>Ingresso Social</h3>
          <button className="ghost icon-button" onClick={onClose} aria-label="Fechar">X</button>
        </div>
        <p>{socialTicketMessage}</p>
        <div className="ticket-modal-code">
          <span>Participante</span>
          <strong>{shortName(ticket.participantName)}</strong>
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onConfirm}>O participante entregou o alimento</button>
          <button className="secondary" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function MeiaCheckinModal({ ticket, onConfirm, onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal confirm-modal">
        <div className="modal-head">
          <h3>Ingresso Meio</h3>
          <button className="ghost icon-button" onClick={onClose} aria-label="Fechar">X</button>
        </div>
        <p>{meiaTicketMessage}</p>
        <div className="ticket-modal-code">
          <span>Participante</span>
          <strong>{shortName(ticket.participantName)}</strong>
        </div>
        <div className="modal-actions">
          <button className="primary" onClick={onConfirm}>O participante apresentou o comprovante</button>
          <button className="secondary" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function CheckinPanel() {
  const [value, setValue] = useState("");
  const [notice, setNotice] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [socialCheckinTicket, setSocialCheckinTicket] = useState(null);
  const [meiaCheckinTicket, setMeiaCheckinTicket] = useState(null);
  const readerRef = useRef(null);
  const qrRef = useRef(null);

  async function validate(input, options = {}) {
    try {
      const data = await api("/api/checkin/validate", {
        method: "POST",
        body: JSON.stringify({
          value: input || value,
          socialFoodDelivered: options.socialFoodDelivered === true,
          meiaProofPresented: options.meiaProofPresented === true
        })
      });
      if (data.requiresSocialFoodConfirmation) {
        setSocialCheckinTicket(data.ticket);
        setMeiaCheckinTicket(null);
        setNotice(null);
        return;
      }
      if (data.requiresMeiaProofConfirmation) {
        setMeiaCheckinTicket(data.ticket);
        setSocialCheckinTicket(null);
        setNotice(null);
        return;
      }
      setNotice({ type: "success", text: data.message });
      setValue("");
      setSocialCheckinTicket(null);
      setMeiaCheckinTicket(null);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    }
  }

  async function confirmSocialFoodDelivery() {
    if (!socialCheckinTicket) return;
    await validate(socialCheckinTicket.code, { socialFoodDelivered: true });
  }

  async function confirmMeiaProofPresented() {
    if (!meiaCheckinTicket) return;
    await validate(meiaCheckinTicket.code, { meiaProofPresented: true });
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
      {socialCheckinTicket && (
        <SocialCheckinModal
          ticket={socialCheckinTicket}
          onConfirm={confirmSocialFoodDelivery}
          onClose={() => setSocialCheckinTicket(null)}
        />
      )}
      {meiaCheckinTicket && (
        <MeiaCheckinModal
          ticket={meiaCheckinTicket}
          onConfirm={confirmMeiaProofPresented}
          onClose={() => setMeiaCheckinTicket(null)}
        />
      )}
    </section>
  );
}

function PaymentHistoryModal({ person, onClose }) {
  const attempts = person.paymentHistory || [];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="payment-history-title">
      <div className="modal payment-history-modal">
        <div className="modal-head">
          <div>
            <h3 id="payment-history-title">Histórico de pagamentos</h3>
            <strong>{person.participantName}</strong>
            <small className="payment-history-phone">{person.participantWhatsapp}</small>
          </div>
          <button type="button" className="ghost icon-button" onClick={onClose} aria-label="Fechar">X</button>
        </div>
        <div className="payment-history-list">
          {attempts.length === 0 && <p>Nenhuma tentativa de pagamento encontrada.</p>}
          {attempts.map((attempt, index) => {
            const pill = ticketStatusPill(attempt);
            const statusDetail = paymentStatusDetailLabel(attempt.mercadoPagoStatusDetail);
            return (
              <article className="payment-history-item" key={attempt.orderId || attempt.paymentId || index}>
                <div className="payment-history-item-head">
                  <div>
                    <span>Tentativa {attempts.length - index}</span>
                    <strong>{formatDateTime(attempt.createdAt || attempt.updatedAt)}</strong>
                  </div>
                  <span className={`pill ${pill.className}`}>{pill.label}</span>
                </div>
                <div className="payment-history-grid">
                  <div>
                    <span>Status Mercado Pago</span>
                    <strong>{paymentStatusLabel(attempt.mercadoPagoStatus)}</strong>
                    {statusDetail && <small>{statusDetail}</small>}
                  </div>
                  <div>
                    <span>Forma de pagamento</span>
                    <strong>{attempt.paymentMethod === "credit_card" ? "Cartão de crédito" : attempt.paymentMethod === "pix" ? "Pix" : "Não informado"}</strong>
                  </div>
                  <div>
                    <span>Compra</span>
                    <strong>{attempt.quantity} {attempt.quantity === 1 ? "ingresso" : "ingressos"}</strong>
                    <small>{(attempt.ticketTypes || []).map(ticketTypeLabel).join(", ")}</small>
                  </div>
                  <div>
                    <span>Valor</span>
                    <strong>{formatCurrency(attempt.total)}</strong>
                  </div>
                  <div>
                    <span>Última atualização</span>
                    <strong>{formatDateTime(attempt.updatedAt)}</strong>
                  </div>
                  <div>
                    <span>Pagamento confirmado</span>
                    <strong>{attempt.paidAt || attempt.confirmedAt ? formatDateTime(attempt.paidAt || attempt.confirmedAt) : "Não se aplica"}</strong>
                    {attempt.manualConfirmedByName && <small>Baixa manual por {attempt.manualConfirmedByName}</small>}
                  </div>
                </div>
                <div className="payment-history-identifiers">
                  <small>Pagamento: {attempt.paymentId || "Não informado"}</small>
                  <small>Pedido: {attempt.orderId || "Não informado"}</small>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AdminPanel({ refresh }) {
  const [summary, setSummary] = useState(null);
  const [settings, setSettings] = useState(null);
  const [users, setUsers] = useState([]);
  const [notice, setNotice] = useState(null);
  const [activeAdminTab, setActiveAdminTab] = useState("dashboard");
  const [paymentHistoryPerson, setPaymentHistoryPerson] = useState(null);
  const [exportingUsers, setExportingUsers] = useState(false);
  const sortedUsers = useMemo(
    () => [...users].sort((first, second) => String(first.name || "").localeCompare(String(second.name || ""), "pt-BR", { sensitivity: "base" })),
    [users]
  );

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
      await refresh();
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

  async function exportUsers() {
    setExportingUsers(true);
    try {
      const token = localStorage.getItem(tokenKey);
      const response = await fetch("/api/admin/users/export", {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Não foi possível gerar a planilha.");
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "usuarios-ingressos.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setExportingUsers(false);
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

  function updateSaleLot(currentSaleLot) {
    setSettings({
      ...settings,
      currentSaleLot,
      ...saleLotPricePresets[currentSaleLot]
    });
  }

  return (
    <>
      <div className="admin-tabs">
        <button type="button" className={activeAdminTab === "dashboard" ? "active" : ""} onClick={() => setActiveAdminTab("dashboard")}>Área exclusiva</button>
        <button type="button" className={activeAdminTab === "permissions" ? "active" : ""} onClick={() => setActiveAdminTab("permissions")}>Permissões de usuários</button>
      </div>
      {activeAdminTab === "dashboard" && (
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
            <label>
              Valor do ingresso social
              <input type="number" min="0" step="0.01" value={settings.socialTicketPrice ?? settings.ticketPrice ?? ""} onChange={(e) => setSettings({ ...settings, socialTicketPrice: e.target.value })} />
            </label>
            <fieldset className="sale-lot-options">
              <legend>Lote atual</legend>
              <label>
                <input type="radio" name="currentSaleLot" value="relampago" checked={(settings.currentSaleLot || "relampago") === "relampago"} onChange={(e) => updateSaleLot(e.target.value)} />
                Lote Relâmpago
              </label>
              <label>
                <input type="radio" name="currentSaleLot" value="lote2" checked={settings.currentSaleLot === "lote2"} onChange={(e) => updateSaleLot(e.target.value)} />
                2 Lote
              </label>
              <label>
                <input type="radio" name="currentSaleLot" value="lote3" checked={settings.currentSaleLot === "lote3"} onChange={(e) => updateSaleLot(e.target.value)} />
                3 Lote
              </label>
            </fieldset>
            <label className="toggle">
              <input type="checkbox" checked={settings.registrationOpen} onChange={(e) => setSettings({ ...settings, registrationOpen: e.target.checked })} />
              Cadastro aberto
            </label>
            <label className="toggle">
              <input type="checkbox" checked={Boolean(settings.ticketSalesClosed)} onChange={(e) => setSettings({ ...settings, ticketSalesClosed: e.target.checked })} />
              Fechado para a venda de ingressos
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
              <Info label="Inteiras vendidas" value={summary.soldByType?.inteiro || 0} />
              <Info label="Meias vendidas" value={summary.soldByType?.meia || 0} />
              <Info label="Sociais vendidas" value={summary.soldByType?.social || 0} />
              <Info label="Total recebido" value={formatCurrency(summary.receivedTotal)} />
            </div>
            <div className="table">
              {summary.tickets.map((ticket) => {
                const pill = ticketStatusPill(ticket);
                const statusDetail = paymentStatusDetailLabel(ticket.mercadoPagoStatusDetail);
                return (
                  <div className="row" key={ticket.id}>
                    <div>
                      <button type="button" className="participant-history-button" onClick={() => setPaymentHistoryPerson(ticket)}>
                        {ticket.participantName}
                      </button>
                      <small>{ticket.participantWhatsapp}</small>
                    </div>
                    <div>
                      <span>Status Mercado Pago</span>
                      <strong>{paymentStatusLabel(ticket.mercadoPagoStatus)}</strong>
                      {statusDetail && <small>{statusDetail}</small>}
                    </div>
                    <div>
                      <span>Baixa</span>
                      <strong>{ticket.hasPaidTickets ? formatDateTime(ticket.paidAt || ticket.confirmedAt) : "Nao se aplica"}</strong>
                    </div>
                    <div>
                      <span>Última rejeição</span>
                      <strong>{ticket.rejectedAt ? formatDateTime(ticket.rejectedAt) : "Nao se aplica"}</strong>
                      {ticket.rejectedCount > 0 && <small>{ticket.rejectedCount} {ticket.rejectedCount === 1 ? "pagamento rejeitado" : "pagamentos rejeitados"}</small>}
                    </div>
                    <div>
                      <span>Baixa manual por</span>
                      <strong>{ticket.manualConfirmedByName || "Nao se aplica"}</strong>
                    </div>
                    <div>
                      <span>Compra</span>
                      <strong>{ticket.purchaseQuantity} {ticket.purchaseQuantity === 1 ? "ingresso" : "ingressos"}</strong>
                      <small>Valor pago: {ticket.hasPaidTickets ? formatCurrency(ticket.purchasePaidTotal) : "Nao se aplica"}</small>
                    </div>
                    <span className={`pill ${pill.className}`}>{pill.label}</span>
                    {ticket.hasPaidTickets ? <span>{ticket.checkinCount > 0 ? "Presente" : "Nao presente"}</span> : <button className="mini" onClick={() => confirmTicket(ticket.latestRejectedTicketId || ticket.id)}>Confirmar</button>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

        </>
      )}

      {activeAdminTab === "permissions" && (
      <section className="panel">
        <div className="panel-title-actions">
          <h2>Permissões de usuários</h2>
          <button type="button" className="secondary" onClick={exportUsers} disabled={exportingUsers}>
            {exportingUsers ? "Gerando planilha..." : "Baixar planilha Excel"}
          </button>
        </div>
        <Notice notice={notice} />
        <div className="user-cards">
          {sortedUsers.map((user) => (
            <article className="user-card" key={user.id}>
              <strong>{user.name}</strong>
              <span>{user.whatsapp}</span>
              <span>{user.email || "E-mail não informado"}</span>
              <span>{user.acquiredTicketCount || 0} {(user.acquiredTicketCount || 0) === 1 ? "ingresso adquirido" : "ingressos adquiridos"}</span>
              <select value={user.role} onChange={(e) => updateRole(user.id, e.target.value)}>
                <option value="usuarios">usuarios</option>
                <option value="checkin">Check-in</option>
                <option value="admin">Área exclusiva</option>
              </select>
            </article>
          ))}
        </div>
      </section>
      )}
      {paymentHistoryPerson && <PaymentHistoryModal person={paymentHistoryPerson} onClose={() => setPaymentHistoryPerson(null)} />}
    </>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [config, setConfig] = useState(null);
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
    const [data, configData] = await Promise.all([
      api("/api/me"),
      api("/api/config")
    ]);
    setUser(data.user);
    setTickets(data.tickets || []);
    setConfig(configData);
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
    if (["usuarios", "participant"].includes(user.role) && !config?.settings?.ticketSalesClosed) items.push({ id: "buy", label: "Comprar ingressos" });
    if (tickets.some(isTicketPaid)) items.push({ id: "tickets", label: "Meus ingressos" });
    if (["checkin", "admin"].includes(user.role)) items.push({ id: "checkin", label: "Acessar painel de check-in" });
    if (user.role === "admin") items.push({ id: "admin", label: "Área exclusiva" });
    return items;
  }, [user, tickets, config]);

  useEffect(() => {
    if (tabs.length && !tabs.find((tab) => tab.id === active)) setActive(tabs[0].id);
  }, [tabs, active]);

  if (loading) return <div className="loading">Carregando...</div>;
  if (!user) return <AuthScreen onAuth={(nextUser) => { setUser(nextUser); refresh(); }} />;

  return (
    <main className="app-shell">
      <header className="topbar">
        <TopbarLogo />
        <div className="topbar-title">
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
