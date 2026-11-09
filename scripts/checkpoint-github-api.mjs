const REPOSITORY = "therunnas/bslogistica";
const SHA = /^[0-9a-f]{40}$/;

// API fixa; sem redirects, transporte de token para outra origem ou logs de respostas.
export function createGitHubApi({ repository, token, allowWrites = false, fetchImpl = fetch }) {
  if (repository !== REPOSITORY || !token) throw new Error("Acesso GitHub não configurado.");
  async function request(path, body) {
    const response = await fetchImpl(`https://api.github.com/${path}`, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      const error = new Error(`Consulta GitHub recusada (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }
  async function get(path) {
    if (path.includes("..") || /[:#\\]/.test(path) || path.startsWith("/")) {
      throw new Error("Endpoint GitHub inválido.");
    }
    return request(`repos/${repository}${path ? "/" + path : ""}`);
  }
  return {
    get,
    async list(path, field) {
      const result = [];
      for (let page = 1; page <= 30; page++) {
        const separator = path.includes("?") ? "&" : "?";
        const data = await get(`${path}${separator}per_page=100&page=${page}`);
        const items = field ? data[field] : data;
        if (!Array.isArray(items)) throw new Error("Lista GitHub incompleta ou inválida.");
        result.push(...items);
        if (items.length < 100) return result;
      }
      throw new Error("Limite de paginação atingido; evidência incompleta recusada.");
    },
    async getFile(path, ref) {
      if (!SHA.test(ref)) throw new Error("Leitura de arquivo exige SHA completo.");
      let data;
      try {
        data = await get(`contents/${path}?ref=${ref}`);
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
      if (
        data.type !== "file" ||
        data.encoding !== "base64" ||
        typeof data.content !== "string" ||
        data.size > 256_000
      ) {
        throw new Error("Arquivo de continuidade não verificável.");
      }
      return Buffer.from(data.content, "base64").toString("utf8");
    },
    async commit({ branch, expectedHeadOid, message, files }) {
      if (
        !allowWrites ||
        !SHA.test(expectedHeadOid) ||
        /^(?:main|master|production|prod|staging|hml)(?:\/|$)/i.test(branch) ||
        files.length !== 2 ||
        files[0].path !== "docs/HANDOFF.md" ||
        !/^docs\/continuidade\/previews\/deployment-[1-9][0-9]*\.json$/.test(files[1].path)
      ) {
        throw new Error("Escrita fora do escopo documental autorizado.");
      }
      const data = await request("graphql", {
        query: `mutation($input: CreateCommitOnBranchInput!) {
          createCommitOnBranch(input: $input) { commit { oid } }
        }`,
        variables: {
          input: {
            branch: { repositoryNameWithOwner: repository, branchName: branch },
            expectedHeadOid,
            message: { headline: message },
            fileChanges: {
              additions: files.map((file) => ({
                path: file.path,
                contents: Buffer.from(file.content, "utf8").toString("base64"),
              })),
            },
          },
        },
      });
      const commit = data.data?.createCommitOnBranch?.commit;
      if (data.errors?.length || !SHA.test(commit?.oid ?? "")) {
        throw new Error(
          "Commit atômico recusado ou resposta desconhecida; reconsultar antes de repetir.",
        );
      }
      return commit;
    },
  };
}
