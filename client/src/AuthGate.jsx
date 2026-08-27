import { useEffect, useState } from 'react';
import App from './App.jsx';
import { api } from './api.js';
import { authConfigured, supabase } from './auth.js';

function Privacy({ onClose }) {
  return <div className="backdrop"><section className="modal privacy"><button className="close" onClick={onClose}>×</button><h2>Privacidade no beta</h2><p>Guardamos seu e-mail e os dados acadêmicos que você cadastrar. O PDF é processado temporariamente pela API e descartado logo após o OCR; seu conteúdo não é salvo nem incluído nos logs.</p><p>O serviço usa Supabase para autenticação e banco de dados e Render para hospedagem. Você pode exportar seus dados ou excluir definitivamente sua conta nas configurações.</p><p>Este é um beta experimental, sem garantia de disponibilidade. Confirme sempre as regras acadêmicas com sua instituição.</p></section></div>;
}

function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [privacy, setPrivacy] = useState(false);
  const submit = async event => {
    event.preventDefault(); setBusy(true); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage('E-mail ou senha inválidos. Se você perdeu o acesso, fale com o administrador do beta.');
    setBusy(false);
  };
  return <main className="auth-page"><section className="auth-card"><div className="wordmark auth-wordmark"><b>25%</b><span>Planejador<br/>de Faltas</span></div><p className="eyebrow">Beta privado</p><h1>Entre no seu planejamento</h1><p>Use as credenciais enviadas pelo administrador.</p><form onSubmit={submit}><label>E-mail<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)}/></label><label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)}/></label>{message && <p className="form-error">{message}</p>}<button disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button></form><button className="privacy-link" onClick={() => setPrivacy(true)}>Como seus dados são tratados</button></section>{privacy && <Privacy onClose={() => setPrivacy(false)}/>}</main>;
}

function ChangePassword({ session }) {
  const [currentPassword, setCurrentPassword] = useState(''); const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async event => {
    event.preventDefault(); setMessage('');
    if (password.length < 10) return setMessage('Use pelo menos 10 caracteres.');
    if (password !== confirmation) return setMessage('As senhas não coincidem.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password, current_password: currentPassword });
    if (error) { setMessage(error.message); setBusy(false); return; }
    try { await api('/api/account/password-changed', { method: 'POST' }); await supabase.auth.refreshSession(); }
    catch (cause) { setMessage(cause.message); }
    setBusy(false);
  };
  return <main className="auth-page"><section className="auth-card"><p className="eyebrow">Primeiro acesso</p><h1>Crie sua senha pessoal</h1><p>A senha temporária de <strong>{session.user.email}</strong> precisa ser substituída antes de continuar.</p><form onSubmit={submit}><label>Senha temporária<input type="password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}/></label><label>Nova senha<input type="password" minLength="10" required value={password} onChange={event => setPassword(event.target.value)}/></label><label>Repita a nova senha<input type="password" minLength="10" required value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>{message && <p className="form-error">{message}</p>}<button disabled={busy}>{busy ? 'Salvando…' : 'Salvar e continuar'}</button></form></section></main>;
}

function Account({ session, onClose }) {
  const [currentPassword, setCurrentPassword] = useState(''); const [nextPassword, setNextPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const changePassword = async event => {
    event.preventDefault(); setMessage(''); if (nextPassword.length < 10) return setMessage('Use pelo menos 10 caracteres.'); setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: nextPassword, current_password: currentPassword }); setMessage(error ? error.message : 'Senha alterada com sucesso.'); setBusy(false);
  };
  const exportData = async () => { const data = await api('/api/account/export'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `planejador-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); };
  const remove = async () => {
    if (confirmation !== 'EXCLUIR' || !currentPassword) return setMessage('Informe sua senha atual e digite EXCLUIR.'); setBusy(true); setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email: session.user.email, password: currentPassword });
    if (error) { setMessage('Senha atual incorreta.'); setBusy(false); return; }
    try { await api('/api/account', { method: 'DELETE', body: JSON.stringify({ confirmation }) }); await supabase.auth.signOut(); }
    catch (cause) { setMessage(cause.message); setBusy(false); }
  };
  return <div className="backdrop"><section className="modal account-modal"><button className="close" onClick={onClose}>×</button><h2>Sua conta</h2><p>{session.user.email}</p><form onSubmit={changePassword}><h3>Alterar senha</h3><label>Senha atual<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}/></label><label>Nova senha<input type="password" minLength="10" value={nextPassword} onChange={event => setNextPassword(event.target.value)}/></label><button disabled={busy}>Alterar senha</button></form><div className="account-actions"><h3>Seus dados</h3><button className="secondary" onClick={exportData}>Exportar em JSON</button><div className="danger-zone"><p>A exclusão é definitiva. Digite <strong>EXCLUIR</strong> e informe sua senha atual acima.</p><input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="EXCLUIR"/><button className="danger" disabled={busy} onClick={remove}>Excluir minha conta</button></div></div>{message && <p className="form-error">{message}</p>}</section></div>;
}

export default function AuthGate() {
  const [session, setSession] = useState(authConfigured ? undefined : null); const [account, setAccount] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next)); return () => data.subscription.unsubscribe();
  }, []);
  if (!authConfigured) return <App/>;
  if (session === undefined) return <main className="loading">Carregando acesso…</main>;
  if (!session) return <Login/>;
  if (session.user.app_metadata?.must_change_password) return <ChangePassword session={session}/>;
  return <><App/><div className="account-fab"><button className="secondary" onClick={() => setAccount(true)}>{session.user.email}</button><button onClick={() => supabase.auth.signOut()}>Sair</button></div>{account && <Account session={session} onClose={() => setAccount(false)}/>}</>;
}
