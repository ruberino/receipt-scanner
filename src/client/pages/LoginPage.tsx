import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiRequestError } from '../api/client.ts';
import { useLogin } from '../api/queries.ts';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const login = useLogin();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    login.mutate(password, {
      onSuccess: () => {
        navigate('/');
      },
      onError: (mutationError) => {
        if (mutationError instanceof ApiRequestError && mutationError.status === 401) {
          setError('Feil passord');
        } else if (mutationError instanceof ApiRequestError && mutationError.status === 429) {
          setError('Prøv igjen om litt');
        } else {
          setError('Noe gikk galt');
        }
      },
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-8 px-5 py-8"
    >
      <h1 className="page-title">Kvitteringer</h1>
      <div className="stack">
        <label htmlFor="password" className="label">
          Passord
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="field"
        />
        <button type="submit" disabled={login.isPending} className="btn btn-primary">
          Logg inn
        </button>
        {error !== null && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
