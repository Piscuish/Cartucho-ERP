/**
 * App de Android: elegir dónde está la base principal (PC o este teléfono) y conectar con el PC.
 */
import { FormEvent, useState } from "react";
import { BrandMark } from "./brand";
import { ArrowLeft, Check, Loader2, Monitor, Search, Smartphone, Wifi } from "lucide-react";
import { api } from "../services/systemClient";
import { setMode, setPc } from "../services/appMode";
import { errorMessage, initials } from "../lib/format";
import { Alert, Button, Field } from "./ui";

type Found = { base: string; tradeName: string | null; logoDataUrl: string | null; version: string | null };

export function MobileStart({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"choose" | "pc">("choose");

  if (step === "pc") return <PcConnect onBack={() => setStep("choose")} onConnected={onDone} />;

  return (
    <div className="mstart">
      <div className="mstart-head">
        <BrandMark size={64} />
        <h1>Cartucho ERP</h1>
        <p className="muted">¿Dónde está la base principal de tu negocio?</p>
      </div>
      <div className="mstart-options">
        <button className="mstart-option" onClick={() => setStep("pc")}>
          <span className="mstart-option-icon">
            <Monitor size={26} />
          </span>
          <span className="mstart-option-body">
            <span className="mstart-option-title">En el PC</span>
            <span className="mstart-option-desc">
              Usa los datos del PC por WiFi. Lo que hagas en el teléfono se ve en el PC y al revés. El PC debe estar encendido con Cartucho abierto.
            </span>
          </span>
        </button>
        <button
          className="mstart-option"
          onClick={() => {
            setMode("local");
            onDone();
          }}
        >
          <span className="mstart-option-icon">
            <Smartphone size={26} />
          </span>
          <span className="mstart-option-body">
            <span className="mstart-option-title">Aquí en el teléfono</span>
            <span className="mstart-option-desc">El programa completo con su propia base en este teléfono. Funciona sin PC y sin Internet.</span>
          </span>
        </button>
      </div>
      <p className="subtle mstart-foot">Puedes cambiarlo después en Configuración › Base principal. Tus datos no se borran.</p>
    </div>
  );
}

function PcConnect({ onBack, onConnected }: { onBack: () => void; onConnected: () => void }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState<"scan" | "connect" | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const use = (f: Found) => {
    setPc({ base: f.base, tradeName: f.tradeName, logoDataUrl: f.logoDataUrl, token: null });
    setMode("pc");
    onConnected();
  };

  const scan = async () => {
    setBusy("scan");
    setError(null);
    try {
      const list = await api.pcDiscover();
      setFound(list);
      if (list.length === 0) setError("No encontramos ningún PC con Cartucho. Revisa que estén en la misma red WiFi y que el acceso desde celulares esté activo en el PC.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return setError("Escribe la dirección que aparece en el PC (Configuración › Celulares).");
    setBusy("connect");
    setError(null);
    try {
      use(await api.pcPing(address));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mstart">
      <button className="mstart-back" onClick={onBack}>
        <ArrowLeft size={18} /> Volver
      </button>
      <div className="mstart-head">
        <span className="mstart-option-icon is-big">
          <Wifi size={28} />
        </span>
        <h1>Conectar con el PC</h1>
        <p className="muted">
          En el PC abre <strong>Configuración › Celulares</strong> y activa el acceso. Conecta el teléfono a la misma red WiFi.
        </p>
      </div>

      <Button variant="primary" size="lg" block icon={busy === "scan" ? <Loader2 size={18} className="spin" /> : <Search size={18} />} disabled={busy !== null} onClick={() => void scan()}>
        {busy === "scan" ? "Buscando en tu red…" : "Buscar el PC en mi red"}
      </Button>

      {found && found.length > 0 && (
        <div className="mstart-found">
          {found.map((f) => (
            <button key={f.base} className="mstart-option" onClick={() => use(f)}>
              <span className={`mstart-option-icon ${f.logoDataUrl ? "has-logo" : ""}`}>
                {f.logoDataUrl ? <img src={f.logoDataUrl} alt="" /> : initials(f.tradeName ?? "PC")}
              </span>
              <span className="mstart-option-body">
                <span className="mstart-option-title">{f.tradeName ?? "Cartucho ERP"}</span>
                <span className="mstart-option-desc">{f.base.replace("http://", "")}</span>
              </span>
              <Check size={18} />
            </button>
          ))}
        </div>
      )}

      <div className="mstart-or">o escribe la dirección</div>
      <form onSubmit={connect} className="mstart-form">
        <Field label="Dirección del PC">
          <input className="input" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="192.168.1.20:8787" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Button type="submit" block loading={busy === "connect"} disabled={busy === "scan"}>
          Conectar
        </Button>
      </form>
      {error && (
        <div className="mt-16">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </div>
  );
}
