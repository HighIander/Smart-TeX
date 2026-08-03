/* SPDX-License-Identifier: CC-BY-NC-SA-4.0 */

((global) => {
  "use strict";

  if (global.SmartTeXNextcloud) return;

  const extensionApi = global.browser ?? global.chrome;
  const CONNECTIONS_KEY = "smarttex:nextcloud-connections:v1";

  function normalizeServer(value) {
    const url = new URL(String(value || "").trim());
    if (!/^https?:$/.test(url.protocol)) {
      throw new Error("The Nextcloud server must use HTTP or HTTPS.");
    }
    return url.href.replace(/\/+$/, "");
  }

  function normalizePath(value) {
    return String(value || "")
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter((part) => part && part !== ".")
      .reduce((parts, part) => {
        if (part === "..") parts.pop();
        else parts.push(part);
        return parts;
      }, [])
      .join("/");
  }

  function encodePath(value) {
    return normalizePath(value)
      .split("/")
      .filter(Boolean)
      .map(encodeURIComponent)
      .join("/");
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function basicAuth(loginName, appPassword) {
    return `Basic ${bytesToBase64(
      new TextEncoder().encode(`${loginName}:${appPassword}`)
    )}`;
  }

  async function runtimeRequest(message) {
    const response = await extensionApi.runtime.sendMessage(message);
    if (!response?.ok) {
      throw new Error(response?.error || "The SmartTeX background request failed.");
    }
    return response;
  }

  async function extensionFetch(url, options = {}) {
    const headers = {};
    new Headers(options.headers || {}).forEach((value, key) => {
      headers[key] = value;
    });
    let bodyText;
    let bodyBase64;
    if (typeof options.body === "string" || options.body instanceof URLSearchParams) {
      bodyText = String(options.body);
    } else if (options.body instanceof ArrayBuffer) {
      bodyBase64 = bytesToBase64(new Uint8Array(options.body));
    } else if (ArrayBuffer.isView(options.body)) {
      bodyBase64 = bytesToBase64(
        new Uint8Array(options.body.buffer, options.body.byteOffset, options.body.byteLength)
      );
    }
    const response = await runtimeRequest({
      type: "smarttex-nextcloud-fetch",
      url,
      method: options.method || "GET",
      headers,
      bodyText,
      bodyBase64
    });
    return new Response(base64ToBytes(response.bodyBase64), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }

  async function responseJson(response, context) {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (_error) {
      throw new Error(`${context} returned an invalid JSON response.`);
    }
  }

  function normalizeConnection(value) {
    if (!value || typeof value !== "object") return null;
    let server;
    try {
      server = normalizeServer(value.server);
    } catch (_error) {
      return null;
    }
    const loginName = String(value.loginName || "").trim();
    const appPassword = String(value.appPassword || "");
    if (!loginName || !appPassword) return null;
    return {
      id: String(
        value.id ||
        global.crypto?.randomUUID?.() ||
        `nextcloud-${Date.now()}-${Math.random().toString(36).slice(2)}`
      ),
      server,
      loginName,
      userId: String(value.userId || loginName),
      appPassword,
      createdAt: String(value.createdAt || new Date().toISOString()),
      lastUsedAt: String(value.lastUsedAt || "")
    };
  }

  async function listConnections() {
    const stored = (await extensionApi.storage.local.get(CONNECTIONS_KEY))?.[CONNECTIONS_KEY];
    return (Array.isArray(stored?.connections) ? stored.connections : [])
      .map(normalizeConnection)
      .filter(Boolean)
      .sort((left, right) => {
        const recent = String(right.lastUsedAt).localeCompare(String(left.lastUsedAt));
        return recent || left.server.localeCompare(right.server);
      });
  }

  async function writeConnections(connections) {
    await extensionApi.storage.local.set({
      [CONNECTIONS_KEY]: {
        version: 1,
        updatedAt: new Date().toISOString(),
        connections: connections.map(normalizeConnection).filter(Boolean)
      }
    });
  }

  async function saveConnection(value) {
    const connection = normalizeConnection(value);
    if (!connection) throw new Error("The Nextcloud connection is incomplete.");
    const connections = await listConnections();
    const duplicate = connections.find((candidate) => (
      candidate.server === connection.server &&
      candidate.loginName === connection.loginName
    ));
    if (duplicate) connection.id = duplicate.id;
    const index = connections.findIndex((candidate) => candidate.id === connection.id);
    if (index >= 0) connections[index] = connection;
    else connections.push(connection);
    await writeConnections(connections);
    return connection;
  }

  async function markConnectionUsed(id) {
    const connections = await listConnections();
    const connection = connections.find((candidate) => candidate.id === id);
    if (!connection) return null;
    connection.lastUsedAt = new Date().toISOString();
    await writeConnections(connections);
    return connection;
  }

  async function getConnection(id) {
    return (await listConnections()).find((connection) => connection.id === id) || null;
  }

  async function ensureOriginPermission(server) {
    const response = await runtimeRequest({
      type: "smarttex-request-origin-permission",
      server: normalizeServer(server)
    });
    if (!response.granted) {
      throw new Error("Permission for this Nextcloud server was not granted.");
    }
    return true;
  }

  async function checkConnection(connectionValue) {
    const connection = normalizeConnection(connectionValue);
    if (!connection) return false;
    try {
      const response = await extensionFetch(
        `${connection.server}/ocs/v2.php/cloud/user?format=json`,
        {
          headers: {
            Authorization: basicAuth(connection.loginName, connection.appPassword),
            "OCS-APIRequest": "true",
            Accept: "application/json"
          }
        }
      );
      return response.ok;
    } catch (_error) {
      return false;
    }
  }

  async function connect(serverValue, onStatus = () => {}) {
    const server = normalizeServer(serverValue);
    await ensureOriginPermission(server);
    onStatus("Starting the Nextcloud client login flow…");
    const start = await extensionFetch(`${server}/index.php/login/v2`, {
      method: "POST"
    });
    if (!start.ok) {
      throw new Error(`Nextcloud login could not be started (${start.status}).`);
    }
    const flow = await responseJson(start, "Nextcloud login");
    if (!flow?.login || !flow?.poll?.endpoint || !flow?.poll?.token) {
      throw new Error("Nextcloud returned an invalid login-flow response.");
    }
    await runtimeRequest({
      type: "smarttex-open-external-tab",
      url: flow.login,
      active: true
    });
    onStatus("Complete login in the opened Nextcloud tab. SmartTeX is waiting for authorization…");

    const deadline = Date.now() + 20 * 60 * 1000;
    let credentials = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => global.setTimeout(resolve, 1800));
      const response = await extensionFetch(flow.poll.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        },
        body: new URLSearchParams({ token: flow.poll.token })
      });
      if (response.status === 404) continue;
      if (!response.ok) {
        throw new Error(`Nextcloud login polling failed (${response.status}).`);
      }
      credentials = await responseJson(response, "Nextcloud login polling");
      break;
    }
    if (!credentials) throw new Error("Nextcloud login timed out.");

    const connectedServer = normalizeServer(credentials.server || server);
    if (new URL(connectedServer).origin !== new URL(server).origin) {
      await ensureOriginPermission(connectedServer);
    }
    const authorization = basicAuth(credentials.loginName, credentials.appPassword);
    let userId = credentials.loginName;
    try {
      const userResponse = await extensionFetch(
        `${connectedServer}/ocs/v2.php/cloud/user?format=json`,
        {
          headers: {
            Authorization: authorization,
            "OCS-APIRequest": "true",
            Accept: "application/json"
          }
        }
      );
      if (userResponse.ok) {
        userId = (await responseJson(userResponse, "Nextcloud user lookup"))
          ?.ocs?.data?.id || userId;
      }
    } catch (_error) {
      // The login credentials themselves are sufficient for WebDAV access.
    }

    const connection = await saveConnection({
      server: connectedServer,
      loginName: credentials.loginName,
      userId,
      appPassword: credentials.appPassword,
      lastUsedAt: new Date().toISOString()
    });
    onStatus(`Connected to ${connection.server} as ${connection.loginName}.`);
    return connection;
  }

  function davBase(connection) {
    return (
      `${connection.server}/remote.php/dav/files/` +
      encodeURIComponent(connection.userId || connection.loginName)
    );
  }

  function davUrl(connection, relativePath = "") {
    const normalized = normalizePath(relativePath);
    return normalized
      ? `${davBase(connection)}/${encodePath(normalized)}`
      : `${davBase(connection)}/`;
  }

  async function davFetch(connection, relativePath, options = {}) {
    return extensionFetch(davUrl(connection, relativePath), {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: basicAuth(connection.loginName, connection.appPassword)
      }
    });
  }

  function davElementText(root, localName) {
    const nodes = root?.getElementsByTagNameNS?.("*", localName);
    return nodes?.[0]?.textContent?.trim?.() || "";
  }

  function decodeDavPath(connection, href) {
    const basePath = new URL(`${davBase(connection)}/`).pathname;
    const pathName = new URL(String(href || ""), connection.server).pathname;
    const encodedRelative = pathName.startsWith(basePath)
      ? pathName.slice(basePath.length)
      : pathName.replace(/^\/+/, "");
    return encodedRelative
      .split("/")
      .filter(Boolean)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch (_error) {
          return part;
        }
      })
      .join("/");
  }

  function parseDavEntries(connection, xmlText) {
    const documentNode = new DOMParser().parseFromString(
      String(xmlText || ""),
      "application/xml"
    );
    if (documentNode.querySelector("parsererror")) {
      throw new Error("Nextcloud returned an invalid WebDAV directory response.");
    }
    return [...documentNode.getElementsByTagNameNS("DAV:", "response")].map((response) => {
      const href = davElementText(response, "href");
      const prop = response.getElementsByTagNameNS("DAV:", "prop")?.[0] || response;
      const resourceType = prop.getElementsByTagNameNS("DAV:", "resourcetype")?.[0];
      const isDirectory = Boolean(
        resourceType?.getElementsByTagNameNS("DAV:", "collection")?.length
      );
      const path = normalizePath(decodeDavPath(connection, href));
      const sizeValue = Number(davElementText(prop, "getcontentlength"));
      return {
        path,
        name: davElementText(prop, "displayname") || path.split("/").pop() || "/",
        isDirectory,
        etag: davElementText(prop, "getetag"),
        fileId: davElementText(prop, "fileid"),
        size: Number.isFinite(sizeValue) ? sizeValue : 0,
        lastModified: davElementText(prop, "getlastmodified"),
        contentType: (
          davElementText(prop, "getcontenttype") ||
          (isDirectory ? "httpd/unix-directory" : "application/octet-stream")
        )
      };
    });
  }

  async function propfind(connection, path = "", depth = 1) {
    const response = await davFetch(connection, path, {
      method: "PROPFIND",
      headers: {
        Depth: String(depth),
        "Content-Type": "application/xml; charset=utf-8"
      },
      body: `<?xml version="1.0" encoding="utf-8"?>
        <d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
          <d:prop>
            <d:displayname />
            <d:resourcetype />
            <d:getetag />
            <d:getcontentlength />
            <d:getlastmodified />
            <d:getcontenttype />
            <oc:fileid />
          </d:prop>
        </d:propfind>`
    });
    if (response.status === 404) {
      throw new Error("The selected Nextcloud file or directory no longer exists.");
    }
    if (response.status !== 207 && !response.ok) {
      throw new Error(`Could not read the Nextcloud directory (${response.status}).`);
    }
    return parseDavEntries(connection, await response.text());
  }

  async function listDirectory(connection, path = "") {
    const normalized = normalizePath(path);
    return (await propfind(connection, normalized, 1))
      .filter((entry) => entry.path !== normalized)
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
        return left.name.localeCompare(right.name, undefined, {
          numeric: true,
          sensitivity: "base"
        });
      });
  }

  async function getFileInfo(connection, path) {
    const normalized = normalizePath(path);
    const entries = await propfind(connection, normalized, 0);
    const exact = entries.find((entry) => entry.path === normalized) || entries[0];
    if (!exact) {
      throw new Error("Nextcloud did not return metadata for the selected file.");
    }
    return exact;
  }

  async function downloadFile(connection, path) {
    const normalized = normalizePath(path);
    const response = await davFetch(connection, normalized, { method: "GET" });
    if (response.status === 404) {
      throw new Error("The selected Nextcloud file no longer exists.");
    }
    if (!response.ok) {
      throw new Error(`Could not download the Nextcloud file (${response.status}).`);
    }
    const blob = await response.blob();
    return {
      blob,
      info: {
        path: normalized,
        name: normalized.split("/").pop() || "file",
        isDirectory: false,
        etag: response.headers.get("etag") || "",
        fileId: response.headers.get("oc-fileid") || "",
        size: blob.size,
        lastModified: response.headers.get("last-modified") || "",
        contentType: (
          blob.type ||
          response.headers.get("content-type") ||
          "application/octet-stream"
        )
      }
    };
  }

  global.SmartTeXNextcloud = Object.freeze({
    CONNECTIONS_KEY,
    normalizeServer,
    normalizePath,
    listConnections,
    getConnection,
    saveConnection,
    markConnectionUsed,
    ensureOriginPermission,
    checkConnection,
    connect,
    listDirectory,
    getFileInfo,
    downloadFile
  });
})(globalThis);
