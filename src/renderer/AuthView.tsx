import { FormEvent, useState } from "react";
import type { AuthUser } from "../shared/types";
import { api } from "./api";

type AuthMode = "login" | "register";

export function AuthView({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [acceptedPasswordResponsibility, setAcceptedPasswordResponsibility] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setPassword("");
    setPasswordConfirmation("");
    setAcceptedPasswordResponsibility(false);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const basicError = validateForm();
    if (basicError) {
      setError(basicError);
      return;
    }

    setBusy(true);
    setError("");
    try {
      const result =
        mode === "login"
          ? await api.authLogin({ username: username.trim(), password })
          : await api.authRegister({
              username: username.trim(),
              password,
              passwordConfirmation,
              acceptedPasswordResponsibility
            });
      onAuthenticated(result.user);
    } catch (requestError) {
      setError(cleanErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  function validateForm() {
    if (!username.trim()) return "Informe o nome de usuário.";
    if (!password) return mode === "login" ? "Informe sua senha." : "Crie uma senha.";
    if (mode === "register") {
      if (username.trim().length < 3) return "O nome de usuário deve ter pelo menos 3 caracteres.";
      if (password.length < 8) return "A senha deve ter pelo menos 8 caracteres.";
      if (password !== passwordConfirmation) return "A confirmação da senha não corresponde.";
      if (!acceptedPasswordResponsibility) return "Confirme sua responsabilidade sobre a senha.";
    }
    return null;
  }

  return (
    <main className="auth-shell">
      <section className={`auth-card ${mode}`} aria-labelledby="auth-title">
        {mode === "register" && <img className="auth-logo" src="./esporte-fai-logo.png" alt="Dukart Music" />}
        <h1 id="auth-title">{mode === "login" ? "Acessar o melhor app do Capão Redondo" : "Vamos criar uma conta"}</h1>

        <form className="auth-form" onSubmit={submit} noValidate>
          <label className="auth-field">
            <span>Username</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              inputMode="text"
              maxLength={32}
              disabled={busy}
              aria-invalid={Boolean(error)}
              autoFocus
            />
          </label>

          <label className="auth-field">
            <span>{mode === "login" ? "Senha" : "Crie uma senha"}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              maxLength={128}
              disabled={busy}
              aria-invalid={Boolean(error)}
            />
          </label>

          {mode === "register" && (
            <>
              <label className="auth-field">
                <span>Confirme sua senha</span>
                <input
                  type="password"
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  autoComplete="new-password"
                  maxLength={128}
                  disabled={busy}
                  aria-invalid={Boolean(error)}
                />
              </label>
              <p className="auth-password-help">Use ao menos 8 caracteres. A senha pode conter somente números.</p>
              <label className="auth-checkbox">
                <input
                  type="checkbox"
                  checked={acceptedPasswordResponsibility}
                  onChange={(event) => setAcceptedPasswordResponsibility(event.target.checked)}
                  disabled={busy}
                />
                <span>Promete que não vai esquecer a senha?</span>
              </label>
            </>
          )}

          <div className="auth-feedback" role="alert" aria-live="polite">
            {error}
          </div>

          <button className="auth-submit pressable" type="submit" disabled={busy}>
            {busy ? "Aguarde..." : "Avançar"}
          </button>
        </form>

        <button
          className="auth-switch"
          type="button"
          onClick={() => changeMode(mode === "login" ? "register" : "login")}
          disabled={busy}
        >
          {mode === "login" ? "Criar uma conta" : "Já tenho uma conta"}
        </button>
      </section>
    </main>
  );
}

function cleanErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente.";
  return raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, "");
}
