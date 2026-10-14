package com.moeum.chat;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class ChatMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        ChatConnectionService.subscribe(this, ChatConnectionService.state(this).getString("instance", null), true);
    }
    @Override public void onMessageReceived(RemoteMessage message) {
        if (!"ring".equals(message.getData().get("action"))) return;
        RemoteMessage.Notification notice = message.getNotification();
        PushNotifications.show(this, notice != null && notice.getTitle() != null ? notice.getTitle() : "모음 채팅 · 알림",
            notice != null && notice.getBody() != null ? notice.getBody() : "친구가 알림을 울렸어요. 채팅방에 들어와 주세요.");
    }
}
