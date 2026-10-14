package com.moeum.chat;

import org.junit.Test;
import static org.junit.Assert.*;

public class ServerLocatorTest {
    @Test public void onlyExactHttpsTunnelOriginsAreAccepted() {
        assertTrue(ServerLocator.allowedAddress("https://our-private-chat.trycloudflare.com"));
        for (String address : new String[]{"http://our-chat.trycloudflare.com", "https://evil.com",
            "https://our-chat.trycloudflare.com.evil.com", "https://user@our-chat.trycloudflare.com",
            "https://our-chat.trycloudflare.com:443", "https://our-chat.trycloudflare.com/path",
            "https://our-chat.trycloudflare.com?url=https://evil.com", "file:///tmp", "garbage"}) {
            assertFalse(address, ServerLocator.allowedAddress(address));
        }
    }
}
