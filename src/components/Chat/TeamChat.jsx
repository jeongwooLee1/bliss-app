import React from 'react'
import { T } from '../../lib/constants'
import ChatHeader from './ChatHeader'
import ChatMessageList from './ChatMessageList'
import ChatInput from './ChatInput'
import { useTeamChat } from './useTeamChat'

// 루트 컨테이너
// 부모가 width/height 결정 (사이드바 안에서 flex:1 등으로 사용)
function TeamChat({ style, extraHeaderRight, scrollTrigger }) {
  const chat = useTeamChat()

  // 메시지 보낼 때 읽음 처리 (= 대화에 참여했다는 신호)
  const handleSend = (text, opts) => {
    chat.send(text, opts)
    if (chat.unreadCount > 0) chat.markAllRead()
  }

  return (
    <div style={{
      display:'flex', flexDirection:'column',
      height:'100%', width:'100%',
      background: T.bgCard,
      ...style,
    }}>
      <ChatHeader
        users={chat.users}
        currentUser={chat.currentUser}
        onSelectUser={chat.setCurrentUserId}
        extraRight={extraHeaderRight}
      />
      <ChatMessageList
        messages={chat.messages}
        userMap={chat.userMap}
        currentUserId={chat.currentUserId}
        lastReadAt={chat.lastReadAt}
        loading={chat.loading}
        scrollTrigger={scrollTrigger}
      />
      <ChatInput
        onSend={handleSend}
        disabled={chat.loading}
      />
    </div>
  )
}

export default TeamChat
