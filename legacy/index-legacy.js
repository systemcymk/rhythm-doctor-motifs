const canvas = document.getElementById("layer1");
const canvas2 = document.getElementById("layer2");
const ctx = canvas.getContext("2d");
const ctx2 = canvas2.getContext("2d");

const CULLING_DISTANCE = 120;

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

function removeFrom(table, value) {
    const index = table.indexOf(value);
    if (index >= 0) table.splice(index, 1);
    return table;
}

function createTrees(newData) {
    mergeData(data, newData);
    const medleys = {}

    const isolates = Object.keys(newData.tracks);

    // Handle ball creation.
    Object.entries(newData.tracks).forEach(([id, track]) => {
        balls[id] = new node(id, track.name ?? track);
        balls[id].resetStyle();

        if (track.prefix) balls[id].prefix = track.prefix
        if (track.subtitle) balls[id].subtitle = track.subtitle
        if (track.leitmotifs) medleys[id] = track.leitmotifs
    });

    // Handle leitmotif connections.
    Object.entries(newData.leitmotifs).forEach(([motif, subdata]) => {
        // Here we handle motif coalescing -
        // if a motif is primarily found in one track, then we consider the motif to be the track itself.
        const motifID = subdata.id ??= motif;
        if (motifID == motif) balls[motifID] = new node(motifID, subdata.name);
        if (subdata.prefix) balls[motifID].prefix = subdata.prefix
        if (subdata.subtitle) balls[motifID].subtitle = subdata.subtitle
        removeFrom(isolates, motifID);
        balls[motifID].isIsolate = false;

        const curBall = balls[motifID];
        ballsMotifs[motif] = curBall;
        curBall.applyStyle("leitmotif");
        if (subdata.style) curBall.applyStyle(subdata.style);

        subdata.associations.forEach(id => {
            console.log(curBall.name);
            curBall.addChild(balls[id]);
            removeFrom(isolates, id);
            balls[id].isIsolate = false;
        });
    });

    // Handle medley styles and connections.
    Object.entries(medleys).forEach(([track, motifs]) => {
        const curBall = balls[track];
        if (Object.keys(motifs).length > 3) curBall.applyStyle("medley");
        removeFrom(isolates, track);
        balls[track].isIsolate = false;

        Object.entries(motifs).forEach(([motif, subdata]) => {
            balls[motif].addChild(curBall);
            removeFrom(isolates, motif);
            balls[motif].isIsolate = false;
        });
    });

    Object.entries(newData.tracks).forEach(([id, track]) => {
        if (balls[id].isIsolate) balls[id].applyStyle("isolate");
        if (track.isMinor) balls[id].applyStyle("minor")
        if (track.style) balls[id].applyStyle(track.style)
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

SPRING_CONSTANT = 0.0015
IDEAL = 100
REPULSE_DISTANCE_MIN = 256
PERMITTIVITY = 250
FRICTION = 0.1
GRAVITY = 0.00025

class node {
    motifs = [];
    children = [];
    isIsolate = true;
    isEnabled = true;

    data;
    prefix;
    subtitle;
    dist = 0;

    style;
    color = "#000000"
    outline = "#00000000"

    sides = 0;
    angle = 0;

    constructor(id, name, x, y) {
        this.x = x == undefined ? node.randomPosition() : x;
        this.y = y == undefined ? node.randomPosition() : y;
        this.id = id;
        this.name = name || id;

        if (this.id.replace(/[0-9\-NX]*/, '') == '') this.prefix = id;
    }

    sx;
    sy;

    draw() {
        if (this.x != this.x) throw "SOMETHING HAS GONE TERRIBLY WRONG . node id: " + this.id + ", node name: " + this.name
        if (!this.isEnabled) return;
        [this.sx,this.sy] = toScreenCoords(this.x,this.y);

        if (this.isOffscreen()) return;
        this.dist = pythagoras(this.sx - cursor.x, this.sy - cursor.y);

        ctx.globalAlpha = node.bodyAlpha(this.dist);
        if (this.sides <= 0) node.drawBall(this);
        else node.drawPolygon(this);

        ctx2.fillStyle = "#ffffff";
        ctx2.strokeStyle = "#000000";

        ctx2.lineWidth = getStrokeZoomed(4);
        ctx2.globalAlpha = node.textAlpha(this.dist);
        const textY = this.getTextY();

        if (!this.prefix) {
            node.drawText(ctx2, this.name, this.sx, textY);
        } else {
            ctx2.textAlign = "left"
            const fullText = this.prefix + " " + this.name;

            const width = ctx2.measureText(this.name).width;
            const fullwidth = ctx2.measureText(fullText).width;

            const postX = this.sx - (width - fullwidth * 0.5);
            node.drawText(ctx2, this.name, postX, textY);

            ctx2.fillStyle = "#ccff22";
            const preX = this.sx - fullwidth * 0.5;
            node.drawText(ctx2, this.prefix, preX, textY);
            ctx2.textAlign = "center";
        }

        if (this.subtitle) {
            ctx.textAlign = "center";
            ctx.fillStyle = "#7f7f7f";
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = ctx2.lineWidth;

            ctx.globalAlpha = ctx2.globalAlpha;
            node.drawText(ctx, this.subtitle, this.sx, this.getTextY(1));

            ctx.lineWidth = 1;
            ctx.globalAlpha = 1;
        }

        ctx2.lineWidth = 1;
        ctx2.globalAlpha = 1;
    }

    getTextY(line = 0) {
        return this.sy + ((line * 18) + 2.5 + this.radius * 2) / zoom;
    }

    static drawText(ctx, text, x, y) {
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
    }

    isOffscreen() {
        if (-CULLING_DISTANCE > this.sx || this.sx > screen.width + CULLING_DISTANCE) return true;
        if (-CULLING_DISTANCE > this.sy || this.sy > screen.height + CULLING_DISTANCE) return true;
        return false;
    }

    vx = 0;
    vy = 0;
    ax = 0;
    ay = 0;

    // Interacts with another ball, handling repulsion and spring physics.
    // If connected, also draws the edge between. Never called if the node is held.
    interact(ball) {
        if (ball.isEnabled && this.id != ball.id) {
            const dx = this.x - ball.x
            const dy = this.y - ball.y
            const dist = pythagoras(dx, dy)

            const isChild = this.motifs.includes(ball);
            if (isChild) drawEdge(this.x, this.y, ball.x, ball.y, node.lineAlpha(this.dist), node.lineWeight(this.dist));

            if (isChild || this.children.includes(ball)) {
                let spring = Math.max(-2000, Math.min(2000, -SPRING_CONSTANT * (dist - IDEAL)))
                if (spring != spring) throw "WHAT THE HELL " + this.id + " " + ball.id
                this.ax += spring * dx / dist;
                this.ay += spring * dy / dist;
            } else {
                let repulsion = Math.min(1000, PERMITTIVITY / Math.max(REPULSE_DISTANCE_MIN, dist**1.5))
                if (repulsion != repulsion) throw "WHAT THE HELL AGAIN " + this.id + " " + ball.id
                this.ax += repulsion * dx / dist;
                this.ay += repulsion * dy / dist;
            }
        }
    }

    // This is used ONLY when the node is dragged.                                                i was here :3c - systemcymk
    // Else, this is handled by interact(), for minor performance reasons.
    drawEdges() {
        Object.entries(this.motifs).forEach(([_, ball]) => {
            drawEdge(this.x, this.y, ball.x, ball.y, 1, 2);
        });
    }

    // Applies motion at the end of every frame.
    // Done separately from the interact() loop to ensure consistency in interactions.
    applyMotion() {
        this.x += this.vx;
        this.y += this.vy;
        this.angle += Math.min(25, pythagoras(this.vx, this.vy) * 0.125) * Math.sign(this.vx) * Math.sign(this.vy)
    }

    // Quick function to add a child to this node.
    // Remember that leitmotifs should be the parent of tracks.
    addChild(ball) {
        this.children.push(ball);
        ball.motifs.push(this);

        this.isolate = false;
        ball.isolate = false;
    }

    // Force-applies the specified style to this node.
    forceStyle(style) {
        if (style) Object.entries(style).forEach(([property, value]) => {
            this[property] = value;
        });
    }

    // Apply the default style to this node.
    resetStyle(id) {
        this.forceStyle(data.styles.default);
    }

    // Apply the specified style (or the current style) to this node.
    applyStyle(id) {
        if (id) this.style = id;
        const style = data.styles[this.style];
        if (style) this.forceStyle(style);
    }

    static bodyAlpha(dist) {
        return Math.max(0.5, Math.min(1, Math.max(75 / dist + 0.5, 100 / dist - 1.5)));
    }

    static textAlpha(dist) {
        return Math.max(0.5, Math.min(1, Math.max(50 / dist + 0.5, 100 / dist - 1.5)));
    }

    static lineAlpha(dist) {
        return Math.max(0.5, Math.min(1, Math.max(25 / dist + 0.5, 75 / dist - 1.5)));
    }

    static lineWeight(dist) {
        return Math.max(1, Math.min(1.25, Math.max(7 / dist + 1, 25 / dist - 1.5)));
    }

    // Draws a circle ball on screen.
    static drawBall(ball) {
        ctx.beginPath();
        ctx.arc(...toScreenCoords(ball.x,ball.y), ball.radius/zoom, 0, Math.PI * 2, true);
        ctx.closePath();

        ctx.fillStyle = ball.color;
        ctx.lineWidth = getStrokeZoomed(4);
        ctx.strokeStyle = ball.outline;

        ctx.stroke();
        ctx.fill();

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
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
        ctx.lineWidth = getStrokeZoomed(4);

        ctx.strokeStyle = ball.outline;
        ctx.stroke();
        ctx.fill();

        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
    }

    static randomPosition() {
        return Math.random() * 500 - 250;
    }
}

function drawEdge(x1,y1,x2,y2,a,w) {
    ctx.strokeStyle = "#aaaacc";
    ctx.globalAlpha = a;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(...toScreenCoords(x1,y1));
    ctx.lineTo(...toScreenCoords(x2,y2));
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
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

    ctx.font = `${16/zoom}px rhythmdoctor`
    ctx2.font = ctx.font

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
        if (dist <= ball.radius / zoom * radius + Math.max(0, zoom * 4 - 4)) {
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

function getStrokeZoomed(size) {
    return Math.max(size, size / zoom);
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


    // // Assumes no newlines. Why add a newline??
    // static drawComplexText(ctx, compound, x, y, sep = ' ') {
    //     const initAlign = ctx.textAlign;
    //     const initColor = ctx.fillStyle;

    //     const fullText = compound.join();
    //     const fullWidth = ctx.measureText(fullText);

    //     const rightmost = x + fullWidth * 0.5;
    //     /* Well, we're only really using... centered aligned text... */
    //     // let rightmost;
    //     // switch (initAlign) {
    //     //     case 'start': 
    //     //         rightmost = ctx.canvas.getComputedStyle("direction") == "ltr" ? x + fullWidth : x;
    //     //         break;
    //     //     case 'end':
    //     //         rightmost = ctx.canvas.getComputedStyle("direction") == "rtl" ? x + fullWidth : x;
    //     //         break;
    //     //     case 'left':
    //     //         rightmost = x + fullWidth;
    //     //         break;
    //     //     case 'right':
    //     //         rightmost = x;
    //     //         break;
    //     //     case 'center':
    //     //         rightmost = x + fullWidth * 0.5;
    //     //         break;
    //     // }

    //     for (let i = compound.length - 1; i >= 0; i--) {
    //         ctx.fillStyle = compound[i]?.color ?? initColor;
    //         ctx.strokeText(text, x, y);
    //         ctx.fillText(text, x, y);
    //     }
    // }