// DOM elements
const chatDiv = document.getElementById("chat-div");
const connStatusDiv = document.getElementById("self-conn-status");
const connId = document.getElementById("conn-id")
const peerIdInput = document.getElementById("peers-id-inp");
const joinPeerButton = document.getElementById("join-peer-btn");
const connectedPeerDiv = document.getElementById("connected-peers");
const sendMessageButton = document.getElementById("send-msg-btn")
const messageInput = document.getElementById('msg-inp')



// Global variables
const peer = new Peer();
const connections = [];

// functions
function connectToOtherPeer() {
  if (peerIdInput.value != "") {
    try {
      const connection = peer.connect(peerIdInput.value);
      connection.on("open", () => {
        connections.push(connection);
        connectedPeerDiv.innerHTML = "";
        connections.forEach((item) => {
          connectedPeerDiv.insertAdjacentHTML("beforeend",'<div class="btn btn-outline btn-accent">'+ item.peer + "</div>");
          item.on("data", (data)=>{
            onMessageReceive(data)
          });
        });
        peerIdInput.value = "";
      });
    } catch (error) {
      console.log(error);
    }
  } else {
    console.log("Please enter a id");
  }
}


function onMessageReceive(message){
  chatDiv.insertAdjacentHTML("beforeend","<div class='chat chat-start'><div class='chat-bubble chat-bubble-primary'>"+message+"</div></div>")
}

function sendMessage(){
  if (messageInput.value != ""){
    try {
      connections.forEach((connection)=>{
        connection.send(messageInput.value)
      })
      chatDiv.insertAdjacentHTML("beforeend", "<div class='chat chat-end'><div class='chat-bubble chat-bubble-secondary'>" +messageInput.value+"</div></div>")
      messageInput.value = "";

    } catch (error) {
      console.log(error)
    }

  }
}





// event listeners
joinPeerButton.onclick = connectToOtherPeer;
sendMessageButton.onclick = sendMessage;


peer.on("open", (id) => {
  connStatusDiv.innerText = "Initialized Connection"
  connId.innerText = id;
});

peer.on("connection", (connection) => {
  connection.on("data", (data)=>{
    onMessageReceive(data)
  });
  connections.push(connection);
  connectedPeerDiv.innerHTML = "";
  connections.forEach((item) => {
    connectedPeerDiv.insertAdjacentHTML("beforeend",'<div class="btn btn-outline btn-accent">'+ item.peer + "</div>");
  });
});

// initailizations
