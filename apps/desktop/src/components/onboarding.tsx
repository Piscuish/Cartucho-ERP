import React, { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  ImagePlus,
  KeyRound,
  Layers,
  Minus,
  ShieldCheck,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AllowedLogoMimeType,
  CompanyProfile,
  CompleteInitialSetupInput,
  LoginInput,
  SaveCompanyProfileInput,
} from "@cartucho/shared";
import { Badge, Button, Card, Input } from "./ui";

const ALLOWED_LOGO_TYPES: readonly AllowedLogoMimeType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

function TopbarWindowControls() {
  const inTauri = isTauri();
  if (!inTauri) return null;

  const handleMinimize = async () => {
    await getCurrentWindow().minimize();
  };

  const handleToggleMaximize = async () => {
    await getCurrentWindow().toggleMaximize();
  };

  const handleClose = async () => {
    await getCurrentWindow().close();
  };

  return (
    <div className="window-controls" aria-label="Controles de ventana">
      <button
        type="button"
        className="win-ctrl-btn"
        onClick={handleMinimize}
        title="Minimizar"
        aria-label="Minimizar ventana"
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="win-ctrl-btn"
        onClick={handleToggleMaximize}
        title="Maximizar o restaurar"
        aria-label="Maximizar o restaurar ventana"
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        className="win-ctrl-btn"
        onClick={handleClose}
        title="Cerrar"
        aria-label="Cerrar ventana"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ==========================================================================
   1. Formulario Reutilizable de Perfil de Empresa (usado en Mi Empresa y Paso 1)
   ========================================================================== */

export interface CompanyProfileFormProps {
  initialCompany: CompanyProfile | null;
  initialDraft?: SaveCompanyProfileInput | null;
  submitLabel: string;
  submitIcon?: React.ReactNode;
  saving: boolean;
  onCancel?: () => void;
  onSubmit: (
    input: SaveCompanyProfileInput,
    previewUrl: string | null
  ) => Promise<void> | void;
}

export function CompanyProfileForm({
  initialCompany,
  initialDraft,
  submitLabel,
  submitIcon,
  saving,
  onCancel,
  onSubmit,
}: CompanyProfileFormProps) {
  const [tradeName, setTradeName] = useState<string>(
    initialDraft?.tradeName ?? initialCompany?.tradeName ?? ""
  );
  const [legalName, setLegalName] = useState<string>(
    initialDraft?.legalName ?? initialCompany?.legalName ?? ""
  );
  const [taxId, setTaxId] = useState<string>(
    initialDraft?.taxId ?? initialCompany?.taxId ?? ""
  );
  const [address, setAddress] = useState<string>(
    initialDraft?.address ?? initialCompany?.address ?? ""
  );
  const [phone, setPhone] = useState<string>(
    initialDraft?.phone ?? initialCompany?.phone ?? ""
  );
  const [email, setEmail] = useState<string>(
    initialDraft?.email ?? initialCompany?.email ?? ""
  );

  const [previewUrl, setPreviewUrl] = useState<string | null>(() => {
    if (initialDraft?.removeLogo) return null;
    if (initialDraft?.logoBase64 && initialDraft?.logoMimeType) {
      return `data:${initialDraft.logoMimeType};base64,${initialDraft.logoBase64}`;
    }
    return initialCompany?.logoDataUrl ?? null;
  });
  const [logoBase64, setLogoBase64] = useState<string | null>(
    initialDraft?.logoBase64 ?? null
  );
  const [logoMimeType, setLogoMimeType] = useState<AllowedLogoMimeType | null>(
    (initialDraft?.logoMimeType as AllowedLogoMimeType | null) ?? null
  );
  const [removeLogo, setRemoveLogo] = useState<boolean>(
    Boolean(initialDraft?.removeLogo)
  );

  const [tradeNameError, setTradeNameError] = useState<string | undefined>(
    undefined
  );
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [logoError, setLogoError] = useState<string | undefined>(undefined);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSelectLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLogoError(undefined);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_LOGO_TYPES.includes(file.type as AllowedLogoMimeType)) {
      setLogoError(
        "Formato no admitido. Selecciona una imagen PNG, JPEG o WEBP."
      );
      e.target.value = "";
      return;
    }

    if (file.size > MAX_LOGO_BYTES) {
      setLogoError("El logotipo supera el límite máximo permitido de 2 MB.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) {
        setLogoError("No fue posible leer el archivo de imagen seleccionado.");
        return;
      }
      const b64Part = result.includes(",")
        ? result.split(",")[1] ?? result
        : result;
      setPreviewUrl(result);
      setLogoBase64(b64Part);
      setLogoMimeType(file.type as AllowedLogoMimeType);
      setRemoveLogo(false);
    };
    reader.onerror = () => {
      setLogoError("Error al procesar el archivo de imagen.");
    };
    reader.readAsDataURL(file);
  };

  const handleClearLogo = () => {
    setPreviewUrl(null);
    setLogoBase64(null);
    setLogoMimeType(null);
    setRemoveLogo(true);
    setLogoError(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTradeNameError(undefined);
    setEmailError(undefined);

    const cleanTradeName = tradeName.trim();
    if (!cleanTradeName) {
      setTradeNameError("El nombre comercial de la empresa es obligatorio.");
      return;
    }

    const cleanEmail = email.trim();
    if (cleanEmail && (!cleanEmail.includes("@") || !cleanEmail.includes("."))) {
      setEmailError("Introduce un correo electrónico con formato válido.");
      return;
    }

    await onSubmit(
      {
        tradeName: cleanTradeName,
        legalName: legalName.trim() || null,
        taxId: taxId.trim() || null,
        address: address.trim() || null,
        phone: phone.trim() || null,
        email: cleanEmail || null,
        logoBase64,
        logoMimeType,
        removeLogo,
      },
      previewUrl
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 18 }}
      noValidate
    >
      {/* Selector de Logotipo (almacenado como BLOB en SQLite) */}
      <div className="logo-uploader-row">
        <div className="logo-preview-frame" aria-hidden="true">
          {previewUrl ? (
            <img src={previewUrl} alt="Vista previa del logotipo" />
          ) : (
            <Building2 size={26} />
          )}
        </div>

        <div className="logo-uploader-actions">
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            Logotipo de la empresa (opcional)
          </span>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Se guarda directamente en la base de datos SQLite local para que
            forme parte de tus copias de seguridad. Formatos aceptados: PNG,
            JPEG o WEBP (máx. 2 MB).
          </span>

          {logoError && (
            <span className="ui-field-error" role="alert">
              {logoError}
            </span>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleSelectLogoFile}
              style={{ display: "none" }}
              id="company-logo-file-input"
            />
            <Button
              type="button"
              variant="secondary"
              icon={<ImagePlus size={14} />}
              disabled={saving}
              onClick={() => fileInputRef.current?.click()}
            >
              {previewUrl ? "Cambiar logotipo" : "Seleccionar imagen"}
            </Button>

            {previewUrl && (
              <Button
                type="button"
                variant="ghost"
                icon={<Trash2 size={14} />}
                disabled={saving}
                onClick={handleClearLogo}
              >
                Quitar logotipo
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Campos principales */}
      <div className="form-grid-2">
        <div style={{ gridColumn: "1 / -1" }}>
          <Input
            id="company-trade-name"
            label="Nombre de la empresa / Nombre comercial *"
            placeholder="Ej. Imprenta Central, Café del Parque, Comercial Andina..."
            value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
            errorText={tradeNameError}
            helperText="Nombre principal que identificará tu espacio de trabajo en Cartucho ERP."
            disabled={saving}
            required
          />
        </div>

        <Input
          id="company-legal-name"
          label="Razón social (opcional)"
          placeholder="Ej. Inversiones y Servicios S.A.S."
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          disabled={saving}
        />

        <Input
          id="company-tax-id"
          label="Identificación tributaria / NIT (opcional)"
          placeholder="Ej. 901.234.567-8"
          value={taxId}
          onChange={(e) => setTaxId(e.target.value)}
          disabled={saving}
        />

        <Input
          id="company-phone"
          label="Teléfono (opcional)"
          placeholder="Ej. +57 300 000 0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={saving}
        />

        <Input
          id="company-email"
          label="Correo electrónico (opcional)"
          type="email"
          placeholder="Ej. administracion@miempresa.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          errorText={emailError}
          disabled={saving}
        />

        <div style={{ gridColumn: "1 / -1" }}>
          <Input
            id="company-address"
            label="Dirección física (opcional)"
            placeholder="Ej. Calle Principal #12-34, Oficina 201"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={saving}
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          paddingTop: 10,
          borderTop: "1px solid var(--border-default)",
        }}
      >
        {onCancel && (
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={onCancel}
          >
            Cancelar
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={saving}
          icon={submitIcon ?? <CheckCircle2 size={15} />}
        >
          {saving ? "Procesando..." : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ==========================================================================
   2. Pantalla de Primera Ejecución: Configuración Inicial Atómica
      (Paso 1: Empresa -> Paso 2: Administrador Principal -> Commit Transaccional)
   ========================================================================== */

export function InitialSetupScreen({
  appVersion,
  existingCompany,
  saving,
  onCompleteSetup,
}: {
  appVersion: string;
  existingCompany: CompanyProfile | null;
  saving: boolean;
  onCompleteSetup: (input: CompleteInitialSetupInput) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [companyDraft, setCompanyDraft] =
    useState<SaveCompanyProfileInput | null>(
      existingCompany
        ? {
            tradeName: existingCompany.tradeName,
            legalName: existingCompany.legalName,
            taxId: existingCompany.taxId,
            address: existingCompany.address,
            phone: existingCompany.phone,
            email: existingCompany.email,
          }
        : null
    );
  const [companyLogoPreview, setCompanyLogoPreview] = useState<string | null>(
    existingCompany?.logoDataUrl ?? null
  );

  // Campos del Paso 2 (Administrador Principal)
  const [fullName, setFullName] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [passwordConfirm, setPasswordConfirm] = useState<string>("");
  const [adminError, setAdminError] = useState<string | null>(null);

  const handleStep1Complete = (
    draft: SaveCompanyProfileInput,
    previewUrl: string | null
  ) => {
    setCompanyDraft(draft);
    setCompanyLogoPreview(previewUrl);
    setStep(2);
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError(null);

    if (!companyDraft) {
      setStep(1);
      return;
    }

    const cleanFullName = fullName.trim();
    const cleanUsername = username.trim();

    if (!cleanFullName) {
      setAdminError("El nombre completo del administrador es obligatorio.");
      return;
    }
    if (cleanUsername.length < 3) {
      setAdminError("El usuario de acceso debe tener al menos 3 caracteres.");
      return;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(cleanUsername)) {
      setAdminError(
        "El nombre de usuario solo puede contener letras, números, puntos, guiones o guiones bajos (sin espacios)."
      );
      return;
    }
    if (password.length < 8) {
      setAdminError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== passwordConfirm) {
      setAdminError("La confirmación de la contraseña no coincide.");
      return;
    }

    try {
      await onCompleteSetup({
        company: companyDraft,
        admin: {
          fullName: cleanFullName,
          username: cleanUsername,
          password,
          passwordConfirm,
        },
      });
    } catch (err: unknown) {
      setAdminError(
        err instanceof Error
          ? err.message
          : "No fue posible completar la configuración inicial."
      );
    }
  };

  return (
    <div className="onboarding-shell">
      <header className="onboarding-topbar" data-tauri-drag-region>
        <div
          style={{ display: "flex", alignItems: "center", gap: 10 }}
          data-tauri-drag-region
        >
          <div className="brand-mark" aria-hidden="true">
            <Layers size={16} />
          </div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            Cartucho ERP
          </span>
          <span className="mono" style={{ color: "var(--text-secondary)" }}>
            v{appVersion}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Badge variant="neutral">
            Configuración Inicial · Paso {step} de 2
          </Badge>
          <TopbarWindowControls />
        </div>
      </header>

      <main className="onboarding-body">
        <div className="onboarding-container">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h1
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "var(--text-primary)",
              }}
            >
              {step === 1
                ? "Bienvenido a Cartucho ERP"
                : "Crear Administrador Principal"}
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
              {step === 1
                ? "Paso 1 de 2: Registra la información comercial de tu empresa. En el siguiente paso crearás la cuenta del administrador para guardar ambos de forma segura."
                : `Paso 2 de 2: Configura las credenciales de acceso del administrador para "${companyDraft?.tradeName}". Los datos de la empresa y del administrador se guardarán de forma atómica en SQLite.`}
            </p>
          </div>

          {step === 1 ? (
            <Card
              title="1. Datos de tu Empresa"
              subtitle="Esta instalación está dedicada a administrar una única empresa en este ordenador"
              icon={<Building2 size={16} />}
            >
              <CompanyProfileForm
                initialCompany={existingCompany}
                initialDraft={companyDraft}
                submitLabel="Continuar a cuenta de administrador"
                submitIcon={<ArrowRight size={15} />}
                saving={saving}
                onSubmit={handleStep1Complete}
              />
            </Card>
          ) : (
            <Card
              title="2. Cuenta del Administrador Principal"
              subtitle="Protege el acceso al panel de tu empresa mediante contraseña segura (Argon2id)"
              icon={<ShieldCheck size={16} />}
            >
              {/* Resumen compacto de la empresa configurada en el Paso 1 */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  backgroundColor: "var(--bg-subtle)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    className="logo-preview-frame"
                    style={{ width: 40, height: 40 }}
                  >
                    {companyLogoPreview ? (
                      <img
                        src={companyLogoPreview}
                        alt={companyDraft?.tradeName}
                      />
                    ) : (
                      <Building2 size={18} />
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {companyDraft?.tradeName}
                    </span>
                    <span
                      style={{ fontSize: 12, color: "var(--text-secondary)" }}
                    >
                      {companyDraft?.taxId
                        ? `NIT / ID: ${companyDraft.taxId}`
                        : "Empresa lista para registrar"}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => setStep(1)}
                >
                  Editar empresa
                </Button>
              </div>

              <form
                onSubmit={handleStep2Submit}
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
                noValidate
              >
                {adminError && (
                  <div
                    role="alert"
                    style={{
                      padding: "10px 12px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--status-error-bg)",
                      border: "1px solid var(--status-error-border)",
                      color: "var(--status-error-text)",
                      fontSize: 12.5,
                    }}
                  >
                    {adminError}
                  </div>
                )}

                <div className="form-grid-2">
                  <Input
                    id="admin-full-name"
                    label="Nombre del administrador *"
                    placeholder="Ej. María Gómez"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={saving}
                    required
                  />

                  <Input
                    id="admin-username"
                    label="Usuario de acceso *"
                    placeholder="Ej. admin o maria.gomez"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    helperText="Mínimo 3 caracteres, sin espacios."
                    disabled={saving}
                    required
                  />

                  <Input
                    id="admin-password"
                    type="password"
                    label="Contraseña *"
                    placeholder="Mínimo 8 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={saving}
                    required
                  />

                  <Input
                    id="admin-password-confirm"
                    type="password"
                    label="Confirmación de contraseña *"
                    placeholder="Repite la contraseña"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    disabled={saving}
                    required
                  />
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    paddingTop: 10,
                    borderTop: "1px solid var(--border-default)",
                  }}
                >
                  <Button
                    type="button"
                    variant="secondary"
                    icon={<ArrowLeft size={14} />}
                    disabled={saving}
                    onClick={() => setStep(1)}
                  >
                    Volver al Paso 1
                  </Button>

                  <Button
                    type="submit"
                    variant="primary"
                    icon={<CheckCircle2 size={15} />}
                    disabled={saving}
                  >
                    {saving
                      ? "Guardando configuración inicial..."
                      : "Finalizar configuración e ingresar"}
                  </Button>
                </div>
              </form>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

/* ==========================================================================
   3. Pantalla de Inicio de Sesión Local (Login Screen)
   ========================================================================== */

export function LoginScreen({
  appVersion,
  company,
  loggingIn,
  onLogin,
}: {
  appVersion: string;
  company: CompanyProfile | null;
  loggingIn: boolean;
  onLogin: (input: LoginInput) => Promise<void>;
}) {
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [loginError, setLoginError] = useState<string | null>(null);

  const displayCompanyName = company?.tradeName || "Cartucho ERP";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (!username.trim() || !password) {
      setLoginError("Introduce tu usuario y contraseña para continuar.");
      return;
    }

    try {
      await onLogin({
        username: username.trim(),
        password,
      });
    } catch (err: unknown) {
      setLoginError(
        err instanceof Error
          ? err.message
          : "Credenciales incorrectas. Verifica tu usuario y contraseña."
      );
    }
  };

  return (
    <div className="onboarding-shell">
      <header className="onboarding-topbar" data-tauri-drag-region>
        <div
          style={{ display: "flex", alignItems: "center", gap: 10 }}
          data-tauri-drag-region
        >
          <div className="brand-mark" aria-hidden="true">
            <Layers size={16} />
          </div>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            Cartucho ERP
          </span>
          <span className="mono" style={{ color: "var(--text-secondary)" }}>
            v{appVersion}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Badge variant="neutral">Acceso Local</Badge>
          <TopbarWindowControls />
        </div>
      </header>

      <main
        className="onboarding-body"
        style={{ alignItems: "center", justifyContent: "center" }}
      >
        <div
          className="onboarding-container"
          style={{ maxWidth: 440, gap: 18 }}
        >
          {/* Identidad visual de la empresa registrada */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: 10,
            }}
          >
            <div
              className="company-logo-box"
              style={{ width: 64, height: 64 }}
              aria-hidden="true"
            >
              {company?.logoDataUrl ? (
                <img src={company.logoDataUrl} alt={displayCompanyName} />
              ) : (
                <Building2 size={28} />
              )}
            </div>

            <div>
              <h1
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  color: "var(--text-primary)",
                }}
              >
                {displayCompanyName}
              </h1>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--text-secondary)",
                  marginTop: 2,
                }}
              >
                Inicia sesión para acceder al espacio de trabajo de tu empresa
              </p>
            </div>
          </div>

          <Card
            title="Iniciar Sesión"
            subtitle="Introduce tus credenciales de acceso local"
            icon={<KeyRound size={16} />}
          >
            <form
              onSubmit={handleSubmit}
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
              noValidate
            >
              {loginError && (
                <div
                  role="alert"
                  style={{
                    padding: "10px 12px",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--status-error-bg)",
                    border: "1px solid var(--status-error-border)",
                    color: "var(--status-error-text)",
                    fontSize: 12.5,
                  }}
                >
                  {loginError}
                </div>
              )}

              <Input
                id="login-username"
                label="Usuario"
                placeholder="Tu nombre de usuario"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loggingIn}
                autoFocus
                required
              />

              <Input
                id="login-password"
                type="password"
                label="Contraseña"
                placeholder="Tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loggingIn}
                required
              />

              <div style={{ paddingTop: 6 }}>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={loggingIn}
                  style={{ width: "100%" }}
                  icon={<KeyRound size={14} />}
                >
                  {loggingIn ? "Verificando acceso..." : "Ingresar al panel"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </main>
    </div>
  );
}
