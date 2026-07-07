const API_BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";
const TOKEN_KEY = "gestor_estoque_token";

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function getErrorMessage(res, fallback) {
  try {
    const err = await res.json();
    return err.detail || fallback;
  } catch {
    return fallback;
  }
}

async function apiRequest(path, options = {}) {
  const token = getAuthToken();
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const error = new Error(await getErrorMessage(res, "Erro na requisicao"));
    error.status = res.status;
    throw error;
  }

  if (res.status === 204) {
    return null;
  }

  return res.json();
}

export async function loginUsuario(credentials) {
  return apiRequest("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
}

export async function listarProdutos() {
  return apiRequest("/produtos");
}

export async function cadastrarProduto(produto) {
  return apiRequest("/produtos", {
    method: "POST",
    body: JSON.stringify(produto),
  });
}

export async function editarProduto(id, produto) {
  return apiRequest(`/produtos/${id}`, {
    method: "PUT",
    body: JSON.stringify(produto),
  });
}

export async function excluirProduto(id) {
  return apiRequest(`/produtos/${id}`, {
    method: "DELETE",
  });
}

export async function listarMovimentacoes() {
  return apiRequest("/movimentacoes");
}

export async function registrarMovimentacao(mov) {
  return apiRequest("/movimentacoes", {
    method: "POST",
    body: JSON.stringify(mov),
  });
}
