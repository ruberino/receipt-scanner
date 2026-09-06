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
      className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-4 p-6"
    >
      <h1 className="text-xl font-bold">Kvitteringer</h1>
      <label htmlFor="password" className="font-medium">
        Passord
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="min-h-11 rounded border border-gray-400 px-3 py-2"
      />
      <button
        type="submit"
        disabled={login.isPending}
        className="min-h-11 rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        Logg inn
      </button>
      {error !== null && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}
