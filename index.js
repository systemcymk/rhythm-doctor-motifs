// import node from "/ball.js";
// import Camera from "/camera.js";
// import { mergeData, removeFrom } from "/utils.js";

const layers = [...document.getElementById("canvas").children];
const camera = new Camera(layers);
const searchCamera = new Camera([document.getElementById("searchlayer")]);

// For the UI + Search menu !!
const sfxPagerIn = new Audio(rootDirectory + '/sfx/sndPagerOpen.ogg');
const sfxPagerOut = new Audio(rootDirectory + '/sfx/sndPagerClose.ogg');
const sfxNope = new Audio(rootDirectory + '/sfx/sndError.ogg');
const sfxFocus = new Audio(rootDirectory + '/sfx/sndPagerCategory.ogg');
const sfxExit = new Audio(rootDirectory + '/sfx/sndTransitionShort.ogg');

var raf; // I'm not sure why this is being kept track of, but... ok!
var cursor = {
    x: 0, y: 0,
    screenX: 0, screenY: 0
}

// Movement keys! :D
movement = {
    W: 0, A: 0, S: 0, D: 0
}

// Keeps track of the canvas area.
var bounds = {
    x: 0, y: 0
}

async function loadJson(path, reloadAll) {
    let rawJson = await fetch(path);
    if (!rawJson.ok) throw new Error(`Couldn't retrieve JSON! ${rawJson.status} - ${rawJson.statusText}`);

    let data = rawJson.json();
    data.then(refreshTree)
}

var balls = {}
var ballsMotifs = {} // for leitmotifs that coalesce into a track
var data = {}

// TODO: Rework implementation. This is still legacy.
function refreshTree(newData) {
    mergeData(data, newData);
    const medleys = {}
    const isolates = Object.keys(newData.tracks);

    // Handle ball creation.
    Object.entries(newData.tracks).forEach(([id, track]) => {
        balls[id] = new node(id, track).setRenderInfo(camera, searchCamera);
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
        if (motifID == motif) balls[motifID] = new node(motifID, subdata).setRenderInfo(camera, searchCamera).resetStyle();
        if (subdata.prefix) balls[motifID].prefix = subdata.prefix
        if (subdata.subtitle) balls[motifID].subtitle = subdata.subtitle
        removeFrom(isolates, motifID);
        balls[motifID].isIsolate = false;

        const curBall = balls[motifID];
        ballsMotifs[motif] = curBall;
        curBall.applyStyle("leitmotif");
        if (subdata.style) curBall.applyStyle(subdata.style);

        subdata.associations.forEach(id => {
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

    searchResults.push(...Object.values(balls));
}

FRICTION = 0.1
GRAVITY = 0.00025
const HALFGRID = 11.5; // Half of the `GridSquare.png`'s size in pixels.

let lastTime = 0;
let edgeLerp = 0;
function draw(timestamp = 0) {
    // If you somehow have perfect 60 FPS, this will always be 1.
    let deltaTime = Math.min(4, (timestamp - lastTime) / (100 / 6)) || 1;

    camera.refresh(deltaTime);
    [cursor.screenX, cursor.screenY] = camera.fromScreenCoords(cursor.x, cursor.y);

    if (document.activeElement == document.body) {
        if (movement.A) camera.x -= 20 * movement.A * deltaTime;
        if (movement.D) camera.x += 20 * movement.D * deltaTime;

        if (movement.W) camera.y -= 20 * movement.W * deltaTime;
        if (movement.S) camera.y += 20 * movement.S * deltaTime;
    }

    // deltaTime *= 2;
    // console.log(deltaTime);

    // Process physics, draw edges
    Object.entries(balls).forEach(([id, ball]) => {
        if (id != draggedNode) {
            ball.vx += ball.ax * 0.5 * deltaTime;
            ball.vy += ball.ay * 0.5 * deltaTime;

            ball.ax = -GRAVITY * ball.x - FRICTION * ball.vx * deltaTime;
            ball.ay = -GRAVITY * ball.y - FRICTION * ball.vy * deltaTime;

            if (ball.isEnabled) {
                Object.entries(balls).forEach(([_, ballb]) => {
                    ball.interact(ballb);
                });
            }
        } else {
            ball.drawEdges();
        }
    });

    // Draw balls, apply physics
    Object.entries(balls).forEach(([id, ball]) => {
        ball.draw();
        if (id != draggedNode) {
            ball.applyMotion(deltaTime);

            ball.vx += ball.ax * 0.5 * deltaTime;
            ball.vy += ball.ay * 0.5 * deltaTime;
        }
    });

    // Draw balls in search menu
    searchCamera.refresh();
    searchCamera.scenes[0].style.height = `${searchResults.length * 69}px`
    Object.entries(searchResults).forEach(([index, ball]) => {
        ball.searchBall.draw(32, index * 69 + 36);
    });

    if (balls[draggedNode]) {
        const node = balls[draggedNode];
        edgeLerp = freyalerp(edgeLerp, node.onScreenEdge ? 1 : 0, 20, deltaTime);

        if (edgeLerp > 0) {
            camera.x = freyalerp(camera.x, lerp(camera.x, balls[draggedNode].x, edgeLerp), 10, deltaTime);
            camera.y = freyalerp(camera.y, lerp(camera.y, balls[draggedNode].y, edgeLerp), 10, deltaTime);

            camera.enforceBoundaries();
            [balls[draggedNode].x, balls[draggedNode].y] =
                camera.fromScreenCoords(dragAnchor.x - dragOffset.x + cursor.x,
                dragAnchor.y - dragOffset.y + cursor.y)
        }
    } 

    if (ballInFocus?.shouldUnfocus && isDragging && (ballInFocus.id != draggedNode)) unfocusBall(searchIndex - 1);

    document.body.style.backgroundPositionX = `${-(camera.x - HALFGRID) / camera.zoom + camera.width * 0.5}px`;
    document.body.style.backgroundPositionY = `${-(camera.y - HALFGRID) / camera.zoom + camera.height * 0.5}px`;
    document.body.style.backgroundSize = `${50 / camera.zoom}px`;

    raf = window.requestAnimationFrame(draw);
    lastTime = timestamp;
}

var isDragging = false
var draggedNode = null

const dragAnchor = { x: 0, y: 0 }
const dragOffset = { x: 0, y: 0 }

const lastPinchPos = {
    x1: 0, y1: 0,
    x2: 0, y2: 0
}

function select(event, radius = 1.5) {
    console.log('triggered');
    if (!Object.entries(balls).some(([id,ball]) => {
        if (!ball.isEnabled) return;
        let [screenx,screeny] = camera.toScreenCoords(ball.x, ball.y);
        const dist = pythagoras(event.pageX - screenx, event.pageY - screeny - camera.getCanvasOffset());
        if (dist <= ball.radius / camera.zoom * radius + Math.max(0, camera.zoom * 4 - 4)) {
            setBallFocus(ball);
            return true;
        }
    }) && ballInFocus) {
        unfocusBall();
    }
}
canvas.ondblclick = select

function dragStart(event, radius = 1.5) {
    isDragging = true
    camera.focus.blocked = true;

    dragOffset.x = event.pageX
    dragOffset.y = event.pageY
    cursor.x = event.pageX;
    cursor.y = event.pageY;
    
    draggedNode = null
    Object.entries(balls).forEach(([id,ball]) => {
        if (!ball.isEnabled) return;
        let [screenx,screeny] = camera.toScreenCoords(ball.x, ball.y);
        const dist = pythagoras(event.pageX - screenx, event.pageY - screeny - camera.getCanvasOffset());
        if (dist <= ball.radius / camera.zoom * radius + Math.max(0, camera.zoom * 4 - 4)) {
            draggedNode = id;
        }
    });
    
    if (draggedNode === null) {
        [dragAnchor.x, dragAnchor.y] = [camera.x, camera.y];
        document.body.style.cursor = "move"
    } else {
        [dragAnchor.x, dragAnchor.y] = camera.toScreenCoords(balls[draggedNode].x, balls[draggedNode].y);
        document.body.style.cursor = "grabbing";
    }
}

let tapTimer = null;
function clearTapTimer() {
    clearTimeout(tapTimer);
    tapTimer = null;
}

canvas.onmousedown = dragStart
canvas.addEventListener("touchstart", event => {
    event.preventDefault();

    if (event.touches.length == 1) {
        if (tapTimer) {
            console.log('tap twice');
            tapTimer = clearTapTimer();
            select(event.touches[0]);
        } else {
            console.log('tap once');
            tapTimer = setTimeout(clearTapTimer, 600);
            dragStart(event.touches[0], 5);
        }

        lastPinchPos.x1 = event.touches[0].pageX
        lastPinchPos.y1 = event.touches[0].pageY
    } else if (event.touches.length == 2) {
        lastPinchPos.x2 = event.touches[1].pageX
        lastPinchPos.y2 = event.touches[1].pageY
    }
}, { passive : false });

function dragMove(event) {
    cursor.x = event.pageX;
    cursor.y = event.pageY;
    if (isDragging) {
        if (draggedNode === null) {
            camera.x = dragAnchor.x + (dragOffset.x - cursor.x) * camera.zoom
            camera.y = dragAnchor.y + (dragOffset.y - cursor.y) * camera.zoom
            if (camera.checkBoundsHit()) {
                [dragOffset.x, dragOffset.y] = [cursor.x, cursor.y];
                [dragAnchor.x, dragAnchor.y] = [camera.x, camera.y];
            }
        } else {
            [balls[draggedNode].x, balls[draggedNode].y] =
                camera.fromScreenCoords(dragAnchor.x - dragOffset.x + cursor.x,
                dragAnchor.y - dragOffset.y + cursor.y)
        }
    }
}

// What is this, chess?
function touchMove(event) {
    if (!isDragging) return;
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
        let [x, y] = camera.fromScreenCoords(centerX, centerY)
        camera.zoom = Math.min(10, Math.max(0.1, camera.zoom * scale))
        let [newx, newy] = camera.fromScreenCoords(centerX, centerY)
        camera.x += -newx + x
        camera.y += -newy + y

        lastPinchPos.x1 = drag.pageX
        lastPinchPos.y1 = drag.pageY
        lastPinchPos.x2 = pinch.pageX
        lastPinchPos.y2 = pinch.pageY
    }
}

document.body.onmousemove = dragMove
document.body.addEventListener("touchmove", touchMove, { passive : false });

function dragEnd(event) {
    isDragging = false
    camera.focus.blocked = false;
    draggedNode = null
    document.body.style.cursor = "auto"
    cursor.x = event.pageX;
    cursor.y = event.pageY;
}

function touchEnd(event) {
    if (event.touches.length >= 1)
        dragStart(event.touches[0], 5);
    else
        dragEnd(event.touches[0]);
}

document.body.onmouseup = dragEnd
// document.body.onmouseleave = dragEnd

window.addEventListener("blur", e => {
    dragEnd(e);
    movement.W = false;
    movement.A = false;
    movement.S = false;
    movement.D = false;
})

document.body.ontouchend = touchEnd
document.body.ontouchcancel = touchEnd

document.onwheel = event => {
    let oldzoom = camera.zoom
    let [x, y] = camera.fromScreenCoords(event.pageX, event.pageY)
    camera.zoom = Math.min(10, Math.max(0.1, camera.zoom*2 ** (event.deltaY/1000)))
    let [newx, newy] = camera.fromScreenCoords(event.pageX, event.pageY)
    camera.x += -newx+x
    camera.y += -newy+y
}

var ballInFocus;
function setBallFocus(ball, sound = true) {
    if (ballInFocus) ballInFocus.inFocus = false;
    ballInFocus = ball;

    if (ballInFocus) {
        ballInFocus.inFocus = true;
        camera.focus.enabled = true;

        const index = searchResults.indexOf(ballInFocus);
        if (index > -1) {
            const searchView = searchCamera.scenes[0].parentNode;
            const bounding = searchView.getBoundingClientRect();

            const height = bounding.bottom - bounding.top - 69;
            const newScroll = index * 69;

            if (newScroll < searchView.scrollTop) {
                searchView.scrollTop = newScroll;
            } else if (newScroll > searchView.scrollTop + height) {
                searchView.scrollTop = newScroll - height; 
            }
        }
        if (sound) {
            sfxPagerIn.currentTime = 0;
            sfxPagerIn.play();
        }
    } else {
        camera.focus.enabled = false;
        if (sound) {
            sfxPagerOut.currentTime = 0;
            sfxPagerOut.play();
        }
    }
}

function unfocusBall(newIndex = 0) {
    searchIndex = newIndex % searchResults.length;
    while (searchIndex < 0) searchIndex += searchResults.length;
    setBallFocus(null);
}

const search = document.getElementById("search");
const searchResults = [];
let searchIndex = 0;

function changeSelect(change) {
    let index = searchResults.indexOf(ballInFocus);
    if (index < 0) index = searchIndex - 1;

    index += change;
    index %= searchResults.length;

    while (index < 0) index += searchResults.length;
    setBallFocus(searchResults[index]);
}

search.addEventListener("keydown", ({key}) => {
    if (key === "Enter") {
        if (searchResults.length > 0) {
            setBallFocus(searchResults[searchIndex]);
            searchIndex = (searchIndex + 1) % searchResults.length;
        } else {
            setBallFocus(null, false);
            sfxNope.currentTime = 0;
            sfxNope.play();
        }
    } else if (key === "ArrowUp") changeSelect(-1);
    else if (key === "ArrowDown") changeSelect(1);
})

search.addEventListener("input", () => {
    if (ballInFocus) unfocusBall();

    // the evil regex ever. ,,
    // const regexStr = "[(" + search.value.replace(/[#-.]|[[-^]|[?|{}]/g, '\\$&').split(" ").join(")(") + ")]";

    // significantly less evil, actually working regex. ,,,,
    searchResults.length = 0;

    if (search.value == '') {
        searchResults.push(...Object.values(balls));
    } else {
        const regexStr = search.value.replace(/[#-.]|[[-^]|[?|{}]/g, '\\$&');
        const regex = new RegExp(regexStr, "i");

        Object.entries(balls).forEach(([id, ball]) => {
            if (ball.filter(regex)) searchResults.push(ball);
        });

        searchResults.sort((a, b) => a.matchString.localeCompare(b.matchString));
        searchResults.sort((a, b) => b.matchPercent - a.matchPercent);
    }
})

searchCamera.scenes[0].onwheel = event => {
    event.stopPropagation();
}

searchCamera.scenes[0].onmousedown = event => {
    event.stopPropagation();
    const ballIndex = Math.floor((event.pageY - searchCamera.scenes[0].getBoundingClientRect().top) / 69);
    if (searchResults[ballIndex]) {
        setBallFocus(searchResults[ballIndex]);
        searchIndex = ballIndex + 1;
    }
}

searchCamera.scenes[0].onmouseup = event => {
    event.stopPropagation();
}

document.addEventListener("keydown", ({key}) => {
    if (key === "Escape") {
        if (ballInFocus) unfocusBall();
        if (document.activeElement == search) {
            search.blur();
        }
    }
    else if (key === "w") movement.W = 1;
    else if (key === "a") movement.A = 1;
    else if (key === "s") movement.S = 1;
    else if (key === "d") movement.D = 1;
    else if (key === "W") movement.W = 2;
    else if (key === "A") movement.A = 2;
    else if (key === "S") movement.S = 2;
    else if (key === "D") movement.D = 2;
    // If you're seeing this... no, no you're not :3c
    // (was lazy, didn't feel like making this elegant)
})

document.addEventListener("keyup", ({key}) => {
    const key2 = key.toLowerCase();
    if (key2 === "w") movement.W = 0;
    else if (key2 === "a") movement.A = 0;
    else if (key2 === "s") movement.S = 0;
    else if (key2 === "d") movement.D = 0;
})

search.addEventListener("focus", ({}) => {
    sfxFocus.currentTime = 0;
    sfxFocus.play();
})

search.addEventListener("blur", ({}) => {
    sfxExit.currentTime = 0;
    sfxExit.play();
})

window.onload = draw;
loadJson(rootDirectory + "/rhythm-doctor-leitmotifs.json");