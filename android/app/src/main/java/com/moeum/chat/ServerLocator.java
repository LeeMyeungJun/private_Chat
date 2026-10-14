package com.moeum.chat;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

final class ServerLocator {
    static final String REGISTRY = "https://api.github.com/repos/LeeMyeungJun/private_Chat/contents/connection.json?ref=connection";

    static boolean allowedAddress(String address) {
        try {
            URI uri = URI.create(address);
            return "https".equals(uri.getScheme()) && uri.getRawUserInfo() == null
                && uri.getPort() == -1 && uri.getHost() != null
                && uri.getHost().matches("[a-z0-9-]+\\.trycloudflare\\.com")
                && (uri.getRawPath() == null || uri.getRawPath().isEmpty())
                && uri.getRawQuery() == null && uri.getRawFragment() == null;
        } catch (Exception error) { return false; }
    }

    static final class Server {
        final String url, instanceId;
        Server(String url, String instanceId) { this.url = url; this.instanceId = instanceId; }
    }

    Server locate() throws Exception {
        JSONObject registry = new JSONObject(get(REGISTRY + "&t=" + System.currentTimeMillis()));
        byte[] decoded = Base64.getMimeDecoder().decode(registry.getString("content"));
        JSONObject descriptor = new JSONObject(new String(decoded, StandardCharsets.UTF_8));
        String address = descriptor.getString("url"), instanceId = descriptor.getString("instanceId");
        if (descriptor.getInt("version") != 1 || !allowedAddress(address)
            || !instanceId.matches("[0-9a-f-]{36}")) throw new IllegalStateException("Invalid server address");
        Server server = new Server(address, instanceId);
        if (!alive(server)) throw new IllegalStateException("Server closed");
        return server;
    }

    boolean alive(Server server) throws Exception {
        JSONObject health = new JSONObject(get(server.url + "/api/health"));
        return health.optBoolean("ok") && server.instanceId.equals(health.optString("instanceId"));
    }

    static String get(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(6000); connection.setReadTimeout(6000);
        connection.setUseCaches(false); connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "MoeumChat-Android/1.0");
        try {
            if (connection.getResponseCode() != 200) throw new IllegalStateException("Server unavailable");
            try (InputStream stream = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int length;
                while ((length = stream.read(buffer)) != -1) {
                    if (out.size() + length > 32768) throw new IllegalStateException("Response too large");
                    out.write(buffer, 0, length);
                }
                return out.toString(StandardCharsets.UTF_8.name());
            }
        } finally { connection.disconnect(); }
    }
}
