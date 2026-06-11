const canvas = document.getElementById("layer1");
const canvas2 = document.getElementById("layer2");
const ctx = canvas.getContext("2d");
const ctx2 = canvas2.getContext("2d");

const LEITMOTIF_COLOR = "#54527aff";
const LEITMOTIF_TRACK_COLOR = "#54527aff";
const TRACK_COLOR = "#b592db";
const MINOR_TRACK_COLOR = "#b592db";
const ISOLATE_COLOR = "#9797b3";

var balls = {}
var ballsMotifs = {} // for leitmotifs that coalesce into a track
let data = {}
async function initiate() {
    let rawJson = await fetch(window.location.origin + "/rhythm-doctor-leitmotifs.json");
    if (!rawJson.ok) {
        rawJson = await fetch(window.location.origin + "/rhythm-doctor-motifs/rhythm-doctor-leitmotifs.json");
        console.log("Running on GitHub Pages!");
        if (!rawJson.ok)
            throw new Error(`Couldn't retrieve JSON! ${rawJson.status} - ${rawJson.statusText}`);
    } else {
        console.log("Running on localhost!");
    }

    let data = rawJson.json();
    data.then(createTrees)
}

function mergeData(base, data) {
    for (const [key, value] of Object.entries(data)) {
        if (key in base && typeof(base[key]) == 'object') {
            mergeData(base[key], value);
        } else {
            base[key] = value;
        }
    }
}

function toTrackData(data) {
    if (typeof data === "object") return data;
    return {
        name: data
    };
}

function trackName(data) {
    if (typeof data === "string") return data;
    return data.name
}

function createTrees(newData) {
    mergeData(data, newData);
    const isolates = Object.keys(newData.trackData);

    const seenTracks = [];
    Object.entries(newData.leitmotifs).forEach(([motif, subdata]) => {
        // Here we handle motif coalescing -
        // if a motif is primarily found in one track, then we consider the motif to be the track itself.
        const motifID = subdata.id ??= motif;
        balls[motifID] = new node(motifID, subdata.name ??= trackName(data.trackData[motifID]), 20, LEITMOTIF_COLOR);
        ballsMotifs[motif] = balls[motifID];

        if (motifID != motif) {
            if (data.trackData[motifID].subtitle) balls[motifID].subtitle = data.trackData[motifID].subtitle;
            balls[motifID].color = LEITMOTIF_TRACK_COLOR;
            balls[motifID].sides = 5;
        }

        seenTracks.push(motifID);
        isolates.splice(isolates.indexOf(motifID), 1);
        if (subdata.subtitle) balls[motifID].subtitle = subdata.subtitle;

        subdata.associations.forEach(track => {
            // Don't do redundant handling.
            if (!seenTracks.includes(track)) {
                balls[track] = new node(track, data.trackData[track].name ?? data.trackData[track], 15, TRACK_COLOR)
                if (data.trackData[track].subtitle) balls[track].subtitle = data.trackData[track].subtitle;
                if (data.trackData[track].isMinor) balls[track].color = MINOR_TRACK_COLOR;
                balls[track].sides = 3;

                seenTracks.push(track);
                isolates.splice(isolates.indexOf(track), 1);
            }

            balls[motifID].children.push(balls[track]);
            balls[track].parents.push(balls[motifID]);
        });
    });

    isolates.forEach(orphan => {
        balls[orphan] = new node(orphan, data.trackData[orphan].name ?? data.trackData[orphan], 15, ISOLATE_COLOR)
    });
}

initiate();

ctx.canvas.width  = window.innerWidth;
ctx.canvas.height = window.innerHeight;

ctx2.canvas.width  = window.innerWidth;
ctx2.canvas.height = window.innerHeight;

ctx.rect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = "#1f1f1f";
ctx.fill();
ctx.beginPath();

function pythagoras(dx, dy) {
    return (dx**2 + dy**2)**0.5;
}

SPRING_CONSTANT = 0.0025
IDEAL = 125
REPULSE_DISTANCE_MIN = 127
PERMITTIVITY = 250
FRICTION = 0.15
GRAVITY = 0.0005

class node {
    parents = [];
    children = [];
    isEnabled = true;

    data;
    subtitle;
    dist = 0;

    sides = 0;
    angle = 0;

    vx = 0;
    vy = 0;
    ax = 0;
    ay = 0;

    constructor(id, name, radius, color, x, y) {
        this.x = x == undefined ? node.randomPosition() : x;
        this.y = y == undefined ? node.randomPosition() : y;
        this.radius = radius
        this.id = id
        this.name = name || id
        this.color = color
    }

    draw() {
        if (!this.isEnabled) return;

        let [sx,sy] = toScreenCoords(this.x,this.y)
        this.dist = pythagoras(sx - cursor.x, sy - cursor.y);

        ctx.globalAlpha = node.bodyAlpha(this.dist);
        if (this.sides <= 0) node.drawBall(this);
        else node.drawPolygon(this);

        ctx2.textAlign = "center"
        ctx2.font = `${16/zoom}px rhythmdoctor`
        // ctx.font = `${300/zoom/Math.max(24, this.name.length)}px rhythmdoctor`
        ctx2.fillStyle = "#ffffff";
        ctx2.strokeStyle = "#000000";

        const textY = sy + (2.5 + this.radius * 2) / zoom;
        ctx2.globalAlpha = node.textAlpha(this.dist);
        ctx2.strokeText(this.name, sx, textY);
        ctx2.fillText(this.name, sx, textY);

        if (this.subtitle) {
            ctx.textAlign = "center"
            ctx.font = `${16/zoom}px rhythmdoctor`
            ctx.fillStyle = "#7f7f7f";
            ctx.strokeStyle = "#000000";

            const textY = sy + (20.5 + this.radius * 2) / zoom;
            ctx.globalAlpha = ctx2.globalAlpha;
            ctx.strokeText(this.subtitle, sx, textY);
            ctx.fillText(this.subtitle, sx, textY);
        }

        ctx.globalAlpha = 1;
        ctx2.globalAlpha = 1;
    }

    // Interacts with another ball, handling repulsion and spring physics.
    // If connected, also draws the edge between. Never called if the node is held.
    interact(ball) {
        if (ball.isEnabled && this.id != ball.id) {
            const dx = this.x - ball.x
            const dy = this.y - ball.y
            const dist = pythagoras(dx, dy)

            const isChild = this.parents.includes(ball);
            if (isChild) drawEdge(this.x, this.y, ball.x, ball.y, node.bodyAlpha(this.dist));

            if (isChild || this.children.includes(ball)) {
                let spring = Math.max(-1000, Math.min(1000, -SPRING_CONSTANT * (dist - IDEAL)))
                this.ax += spring * dx / dist;
                this.ay += spring * dy / dist;
            } else {
                let repulsion = Math.min(1000, PERMITTIVITY / Math.max(REPULSE_DISTANCE_MIN, dist**1.5))
                this.ax += repulsion * dx / dist;
                this.ay += repulsion * dy / dist;
            }
        }
    }

    // This is used ONLY when the node is dragged.                                                i was here :3c - systemcymk
    // Else, this is handled by interact(), for minor performance reasons.
    drawEdges() {
        Object.entries(this.parents).forEach(([_, ball]) => {
            drawEdge(this.x, this.y, ball.x, ball.y, 1);
        });
    }

    // Applies motion at the end of every frame.
    // Done separately from the interact() loop to ensure consistency in interactions.
    applyMotion() {
        this.x += this.vx;
        this.y += this.vy;
        this.angle += Math.min(25, pythagoras(this.vx, this.vy) * 0.125) * Math.sign(this.vx) * Math.sign(this.vy)
    }

    static bodyAlpha(dist) {
        return Math.max(0.5, Math.min(1, 500 / dist));
    }

    static textAlpha(dist) {
        return Math.max(0.5, Math.min(1, Math.max(50 / dist + 0.5, 150 / dist - 1.5)));
    }

    // Draws a circle ball on screen.
    static drawBall(ball) {
        ctx.beginPath();
        ctx.arc(...toScreenCoords(ball.x,ball.y), ball.radius/zoom, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fillStyle = ball.color;
        ctx.fill();
    }

    // Jesus christ
    static drawPolygon(ball) {
        ctx.beginPath();
        const [x, y] = toScreenCoords(ball.x, ball.y);

        const rad = Math.PI * 2 + ball.angle;
        const radius = ball.radius / zoom;
        ctx.moveTo(x + Math.cos(rad) * radius, y + Math.sin(rad) * radius);

        for (let i = 1; i <= ball.sides; i++) {
            const rad = Math.PI * 2 * (i / ball.sides) + ball.angle;
            ctx.lineTo(x + Math.cos(rad) * radius, y + Math.sin(rad) * radius);
        }

        ctx.closePath();
        ctx.fillStyle = ball.color;
        ctx.fill();
    }

    static randomPosition() {
        return Math.random() * 200 - 100;
    }
}

function drawEdge(x1,y1,x2,y2,a) {
    ctx.strokeStyle = "#aaaacc";
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(...toScreenCoords(x1,y1));
    ctx.lineTo(...toScreenCoords(x2,y2));
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function drawEdgeDir(x1,y1,x2,y2,a,r,r1,spread) {
    ctx.strokeStyle = "#aaaacc";
    ctx.fillStyle = "#aaaacc";
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(...toScreenCoords(x1,y1));
    ctx.lineTo(...toScreenCoords(x2,y2));
    ctx.stroke();
    let t = Math.atan2(y2-y1,x2-x1)
    ctx.beginPath();
    ctx.moveTo(...toScreenCoords(x2-r1*Math.cos(t),y2-r1*Math.sin(t)));
    ctx.lineTo(...toScreenCoords(x2-r1*Math.cos(t)+r*Math.cos(t+spread*PI/4),y2-r1*Math.sin(t)+r*Math.sin(t+spread*PI/4)));
    ctx.lineTo(...toScreenCoords(x2-r1*Math.cos(t)+r*Math.cos(t-spread*PI/4),y2-r1*Math.sin(t)+r*Math.sin(t-spread*PI/4)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
}

var cursor = {
    x: 0, y: 0,
    screenX: 0, screenY: 0
}

var xoffset = 0
var yoffset = 0
var zoom = 1

function getCanvasOffset() {
    return canvas.getBoundingClientRect().top;
}

function* toScreenCoords(x,y) {
    yield (x-xoffset)/zoom+canvas.width/2
    yield (y-yoffset)/zoom+canvas.height/2
}
function* fromScreenCoords(x,y) {
    yield (x-canvas.width/2)*zoom + xoffset
    yield (y-canvas.height/2)*zoom + yoffset
}

function clear() {
    ctx.fillStyle = "#1f1f1f88";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx2.clearRect(0, 0, canvas.width, canvas.height);
}

function draw() {
    clear();
    ctx.canvas.width  = window.innerWidth;
    ctx.canvas.height = window.innerHeight;

    ctx2.canvas.width  = window.innerWidth;
    ctx2.canvas.height = window.innerHeight;
    [cursor.screenX, cursor.screenY] = fromScreenCoords(cursor.x, cursor.y);

    // Process physics, draw edges
    Object.entries(balls).forEach(([id, ball]) => {
        if (id != draggedNode) {
            ball.vx += ball.ax;
            ball.vy += ball.ay;
            ball.ax = -GRAVITY * ball.x - FRICTION * ball.vx
            ball.ay = -GRAVITY * ball.y - FRICTION * ball.vy
            Object.entries(balls).forEach(([_, ballb]) => {
                ball.interact(ballb);
            });
        } else {
            ball.drawEdges();
        }
    });

    // Draw balls, apply physics
    Object.entries(balls).forEach(([id,ball]) => {
        ball.draw()
        if (id != draggedNode) {
            ball.applyMotion();
        }
    });

    raf = window.requestAnimationFrame(draw);
}

var isDragging = false
var draggedNode = null

const dragAnchor = { x: 0, y: 0 }
const dragOffset = { x: 0, y: 0 }

const lastPinchPos = {
    x1: 0, y1: 0,
    x2: 0, y2: 0
}

function dragStart(event, radius = 1.5) {
    isDragging = true
    document.body.style.cursor = "move"
    dragOffset.x = event.pageX
    dragOffset.y = event.pageY
    
    draggedNode = null
    Object.entries(balls).forEach(([id,ball]) => {
        let [screenx,screeny] = toScreenCoords(ball.x, ball.y)
        const dist = pythagoras(event.pageX - screenx, event.pageY - screeny - getCanvasOffset());
        if (dist <= ball.radius / zoom * radius) {
            draggedNode = id
        }
    });
    
    if (draggedNode === null) {
        dragAnchor.x = xoffset
        dragAnchor.y = yoffset
    } else {
        [dragAnchor.x, dragAnchor.y] = toScreenCoords(balls[draggedNode].x, balls[draggedNode].y)
    }
}

canvas.onmousedown = dragStart
canvas.ontouchstart = event => {
    event.preventDefault();
    if (event.touches.length == 1) {
        dragStart(event.touches[0], 5);
        lastPinchPos.x1 = event.touches[0].pageX
        lastPinchPos.y1 = event.touches[0].pageY
    } else if (event.touches.length == 2) {
        lastPinchPos.x2 = event.touches[1].pageX
        lastPinchPos.y2 = event.touches[1].pageY
    }
}

function dragMove(event) {
    cursor.x = event.pageX;
    cursor.y = event.pageY;
    if (isDragging) {
        if (draggedNode === null) {
            xoffset = Math.min(10000,Math.max(-10000,dragAnchor.x+(dragOffset.x-event.pageX)*zoom))
            yoffset = Math.min(5000,Math.max(-5000,dragAnchor.y+(dragOffset.y-event.pageY)*zoom))
        } else {
            [balls[draggedNode].x, balls[draggedNode].y] = fromScreenCoords(dragAnchor.x-dragOffset.x+event.pageX,dragAnchor.y-dragOffset.y+event.pageY)
        }
    }
}

canvas.onmousemove = dragMove
canvas.ontouchmove = event => {
    event.preventDefault();

    let swipingDrag = false;
    let swipingPinch = false;
    const drag = event.touches[0];
    const pinch = event.touches[1];
    
    for (const touch of event.changedTouches) {
        if (drag && touch.identifier == drag.identifier) swipingDrag = true;
        if (pinch && touch.identifier == pinch.identifier) swipingPinch = true;
    }

    if (!pinch) {
        if (swipingDrag) dragMove(drag);
        return;
    }

    if (swipingDrag || swipingPinch) {
        const distLast = pythagoras(lastPinchPos.x1 - lastPinchPos.x2, lastPinchPos.y1 - lastPinchPos.y2)
        const dist = pythagoras(drag.pageX - pinch.pageX, drag.pageY - pinch.pageY);

        const centerX = (drag.pageX + pinch.pageX) * 0.5;
        const centerY = (drag.pageY + pinch.pageY) * 0.5;

        const scale = distLast / dist;
        let [x,y] = fromScreenCoords(centerX, centerY)
        zoom = Math.min(10, Math.max(0.1, zoom * scale))
        let [newx,newy] = fromScreenCoords(centerX, centerY)
        xoffset += -newx+x
        yoffset += -newy+y

        lastPinchPos.x1 = drag.pageX
        lastPinchPos.y1 = drag.pageY
        lastPinchPos.x2 = pinch.pageX
        lastPinchPos.y2 = pinch.pageY
    }
}

function dragEnd(event) {
    isDragging = false
    draggedNode = null
    document.body.style.cursor = "auto"
}

function touchEnd(event) {
    if (event.touches.length >= 1)
        dragStart(event.touches[0], 5);
    else
        dragEnd(event);
}

canvas.onmouseup = dragEnd
canvas.onmouseleave = dragEnd

canvas.ontouchend = touchEnd
canvas.ontouchcancel = touchEnd

document.onwheel = event => {
    let oldzoom = zoom
    let [x,y] = fromScreenCoords(event.pageX,event.pageY)
    zoom = Math.min(10,Math.max(0.1,zoom*2**(event.deltaY/1000)))
    let [newx,newy] = fromScreenCoords(event.pageX,event.pageY)
    xoffset += -newx+x
    yoffset += -newy+y
}
