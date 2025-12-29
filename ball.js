const EDGE_DISTANCE = 120;
const UNFOCUS_DISTANCE = 120;
const CULLING_DISTANCE = 120;

SPRING_CONSTANT = 0.0015
IDEAL = 100
REPULSE_DISTANCE_MIN = 256
PERMITTIVITY = 250

class node {
    data; // This is the raw JSON definition of this node, used to display names, subtitles, etc.
    impliedPrefix; // If the prefix is 'implied', just use the ID of the node.
    isIsolate = true; // Used ONLY on tree refresh, to apply the isolate color style.

    isEnabled = true; // Handles if the node should be processed in drawing and physics calculations
    inFocus = false; // Tracks if this node is in the camera's focus. Handled by index.js.

    // Used in searching only; used for sorting searches.
    matchString;
    matchPercent = 0;
    searchBall;
    searchTerms;

    id; // Must be present.
    get name() { return this.data.name || this.data; }
    get subtitle() { return this.data.subtitle; } // May be null!
    get prefix() { return this.impliedPrefix ? this.id : this.data.prefix; }

    // Relationships!
    motifs = [];
    children = [];

    // Rendering information
    x = 0; y = 0;
    sides = 0; angle = 0;

    // Scene information
    camera;
    get edgeLayer() { return this.camera.layers[0]; }
    get bodyLayer() { return this.camera.layers[1]; }
    get textLayer() { return this.camera.layers[2]; }

    // Styling information
    color = "#000000";
    outline = "#00000000";
    thin = false; // If true, stops stroke from bleeding (visible when opacity < 1).

    static thickOutline = false;

    // Creates the node. Note that the returned node isn't ready - camera and styles still need to be set.
    constructor(id, jsonDefinition, x, y) {
        this.id = id;
        this.data = jsonDefinition;
        this.x = (x == undefined) ? node.randomPosition() : x;
        this.y = (y == undefined) ? node.randomPosition() : y;
        this.impliedPrefix = (this.id.replace(/[0-9\-NX]*/, '') == '');

        this.searchTerms = [
            {
                weight: 1,
                terms: [this.id, this.name, this.prefix]
            },
            {
                weight: 0.5,
                terms: [this.subtitle]
            },
        ];
    }

    dist; // The distance of the ball from the mouse cursor.
    scenedist; // Ditto, but in scenespace, not screenspace.
    sx; sy; // The coordinates transposed to screenspace :3c

    // Draws the whole ball unto the screen using `bodyLayer` and `textLayer`.
    // TODO: I wonder if we can rewrite this to be cleaner in the future -w-"
    draw() {
        if (this.x != this.x) throw "Position is NaN, something went wrong! - id: " + this.id + ", node name: " + this.name
        if (!this.isEnabled && !this.inFocus) return;

        [this.sx, this.sy] = this.camera.toScreenCoords(this.x, this.y);
        if (this.inFocus) [this.camera.focus.x, this.camera.focus.y] = [this.x, this.y];

        if (this.isOffscreen) return;
        this.dist = pythagoras(this.sx - cursor.x, this.sy - cursor.y);
        this.scenedist = pythagoras(this.x - cursor.screenX, this.y - cursor.screenY);

        // Shorthands, so the code doesn't look as messy
        const ctx = this.bodyLayer;
        const ctx2 = this.textLayer;

        // Draw the body
        ctx.globalAlpha = this.inFocus ? 1 : node.bodyAlpha(this.scenedist);
        if (this.sides <= 0) node.drawBall(this);
        else node.drawPolygon(this);

        ctx2.fillStyle = "#ffffff";
        ctx2.strokeStyle = "#000000";

        ctx2.lineWidth = node.getStrokeZoomed(4, this.camera.zoom);
        ctx2.globalAlpha = this.inFocus ? 1 : node.textAlpha(this.scenedist);
        const textY = this.sy + this.getTextOffset();

        if (!this.prefix) {
            ctx2.textAlign = "center";
            node.drawText(ctx2, this.name, this.sx, textY);
        } else {
            // It's depressing how complicated this has to be just to draw text of differing colors :sob:
            // This code also only really works here; always assumes that the text alignment is "center".
            ctx2.textAlign = "left"
            const fullText = this.prefix + " " + this.name;

            const width = ctx2.measureText(this.name).width;
            const fullwidth = ctx2.measureText(fullText).width;

            const postX = this.sx - (width - fullwidth * 0.5);
            node.drawText(ctx2, this.name, postX, textY);

            ctx2.fillStyle = "#ccff22";
            const preX = this.sx - fullwidth * 0.5;
            node.drawText(ctx2, this.prefix, preX, textY);
        }

        if (this.subtitle) {
            ctx.textAlign = "center";
            ctx.fillStyle = "#7f7f7f";
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = ctx2.lineWidth;

            ctx.globalAlpha = ctx2.globalAlpha;
            node.drawText(ctx, this.subtitle, this.sx, this.sy + this.getTextOffset(1));

            ctx.lineWidth = 1;
            ctx.globalAlpha = 1;
        }

        ctx2.lineWidth = 1;
        ctx2.globalAlpha = 1;
    }

    get isOffscreen() {
        if (-CULLING_DISTANCE > this.sx || this.sx > camera.width + CULLING_DISTANCE) return true;
        if (-CULLING_DISTANCE > this.sy || this.sy > camera.height + CULLING_DISTANCE * 2) return true;
        return false;
    }

    get onScreenEdge() {
        if (EDGE_DISTANCE > this.sx || this.sx > camera.width - EDGE_DISTANCE) return true;
        if (EDGE_DISTANCE > this.sy || this.sy > camera.height - EDGE_DISTANCE * 2) return true;
        return false;
    }

    get shouldUnfocus() {
        if (UNFOCUS_DISTANCE > this.sx || this.sx > camera.width - UNFOCUS_DISTANCE) return true;
        if (UNFOCUS_DISTANCE > this.sy || this.sy > camera.height - UNFOCUS_DISTANCE * 2) return true;
        return false;
    }

    // Used in text rendering, generally when subtitles are present.
    getTextOffset(line = 0) {
        return ((line * 18) + 2.5 + this.radius * 2) / this.camera.zoom;
    }

    // Sets the camera used by the node. Returns itself for chaining.
    setRenderInfo(camera, search) {
        this.camera = camera;
        this.searchBall = new searchnode(this, search);
        return this;
    }

    // Draws text on a layer. Nodes often need to use this more than once,
    // and on different layers - which is why it won't simply accept a ball as an argument.
    static drawText(layer, text, x, y) {
        layer.strokeText(text, x, y);
        layer.fillText(text, x, y);
    }

    // Renders the ball either as a polygon or a circle.
    static drawGeneric(ball) {
        if (ball.sides <= 0) node.drawBall(ball);
        else node.drawPolygon(ball);
    }

    // Renders the ball as a polygon.
    // Used over `drawBall()` when `sides > 0`.
    static drawPolygon(ball) {
        const ctx = ball.bodyLayer;
        const [x, y] = [ball.sx, ball.sy];

        const rad = Math.PI * 2 + ball.angle;
        const radius = ball.radius / ball.camera.zoom;
        const diameter = radius * 2;

        ctx.beginPath();
        ctx.moveTo(x + Math.cos(rad) * radius, y + Math.sin(rad) * radius);

        for (let i = 1; i <= ball.sides; i++) {
            const rad = Math.PI * 2 * (i / ball.sides) + ball.angle;
            ctx.lineTo(x + Math.cos(rad) * radius, y + Math.sin(rad) * radius);
        }

        ctx.closePath();

        ctx.fillStyle = ball.color;
        ctx.lineWidth = node.getStrokeZoomed(4, ball.camera.zoom);
        ctx.strokeStyle = ball.inFocus ? "#ffffff" : (node.thickOutline ? "#000000" : ball.outline);
        ctx.stroke();

        if (ball.thin) {
            ctx.save();
            ctx.clip();
            ctx.clearRect(x - radius, y - radius, diameter, diameter);
            ctx.restore();
        }

        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
    }

    // Renders the ball as a... ball, I guess?????
    // Used over `drawPolygon()` when `sides == 0`.
    static drawBall(ball) {
        const ctx = ball.bodyLayer;
        const radius = ball.radius / ball.camera.zoom;

        ctx.beginPath();
        ctx.arc(ball.sx, ball.sy, radius, 0, Math.PI * 2, true);
        ctx.closePath();

        ctx.fillStyle = ball.color;
        ctx.lineWidth = node.getStrokeZoomed(4, ball.camera.zoom);
        ctx.strokeStyle = ball.inFocus ? "#ffffff" : (node.thickOutline ? "#000000" : ball.outline);
        ctx.stroke();

        if (ball.thin) {
            ctx.save();
            ctx.clip();
            ctx.clearRect(ball.sx - radius, ball.sy - radius, diameter, diameter);
            ctx.restore();
        }

        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
    }

    // The random position applied to a node on creation.
    static randomPosition() {
        return Math.random() * 500 - 250;
    }

    // Velocity & acceleration
    vx = 0; vy = 0;
    ax = 0; ay = 0;

    // Interacts with another ball, handling repulsion and spring physics.
    // If connected, also draws the edge between. Never called if the node is held.
    interact(ball) {
        if (ball.isEnabled && this.id != ball.id) {
            const dx = this.x - ball.x
            const dy = this.y - ball.y
            const dist = pythagoras(dx, dy)

            const isChild = this.motifs.includes(ball);
            if (isChild) this.drawEdge(ball, node.lineAlpha(this.dist), node.lineWeight(this.dist));

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

    // Checks `sub`string's resemblance to any part of the node.
    // Used in searching :3c
    filter(sub) {
        this.matchPercent = 0;
        this.matchString = null;

        this.searchTerms.forEach((data) => {
            data.terms.forEach((str) => {
                if (!str) return;
                const percent = (str.match(sub)?.join("")?.length ?? 0) / str.length * data.weight;
                if (this.matchPercent < percent) {
                    this.matchPercent = percent;
                    this.matchString = str.charAt();
                }
            })
        })

        const matched = this.matchPercent > 0;

        // Prioritize non-minor tracks.
        if (this.data?.isMinor) this.matchPercent--;
        return matched;
    }

    // This is used ONLY when the node is dragged.                                           i was here :3c - systemcymk
    // Else, this is handled by interact(), for minor performance reasons.
    drawEdges() {
        Object.entries(this.motifs).forEach(([_, ball]) => {
            this.drawEdge(ball, 1, 2);
        });
    }

    // Draw an edge to another ball.
    drawEdge(ball, alpha, width) {
        const ctx = ball.edgeLayer;

        ctx.strokeStyle = "#92a39bff";
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;

        ctx.beginPath();
        ctx.moveTo(...this.camera.toScreenCoords(this.x, this.y));
        ctx.lineTo(...this.camera.toScreenCoords(ball.x, ball.y));
        ctx.stroke();

        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
    }

    // Applies motion at the end of every frame.
    // Done separately from the interact() loop to ensure consistency in interactions.
    applyMotion(deltaTime) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;
        this.angle += Math.min(25, pythagoras(this.vx, this.vy) * 0.125 * deltaTime) * Math.sign(this.vx) * Math.sign(this.vy);
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
        return this;
    }

    // Apply the default style to this node.
    resetStyle(id) {
        this.forceStyle(data.styles.default);
        return this;
    }

    // Apply the specified style (or the current style) to this node.
    applyStyle(id) {
        if (id) this.style = id;
        const style = data.styles[this.style];
        if (style) this.forceStyle(style);
        return this;
    }

    static bodyAlpha(dist) {
        return Math.max(0.5, Math.min(1, Math.max(75 / dist + 0.5, 100 / dist - 1.5)));
    }

    static textAlpha(dist) {
        return Math.max(0.5, Math.min(1, Math.max(50 / dist + 0.5, 100 / dist - 1.5)));
    }

    static lineAlpha(dist) {
        return Math.max(0.25, Math.min(1, Math.max(16 / dist + 0.5, 50 / dist - 1.5)));
    }

    static lineWeight(dist) {
        return Math.max(1, Math.min(1.25, Math.max(7 / dist + 1, 25 / dist - 1.5)));
    }

    // Text stroke.
    static getStrokeZoomed(size, zoom) {
        return Math.max(size, size / zoom);
    }
}

class searchnode {
    sx; sy;
    camera; bodyLayer;
    constructor(ball, camera) {
        this.ball = ball;
        this.camera = camera;
        this.bodyLayer = camera.layers[0];
    }

    get ctx() { return this.bodyLayer; }
    get color() { return this.ball.color; }
    get outline() { return this.ball.outline; }
    get inFocus() { return this.ball.inFocus; }
    get radius() { return this.ball.radius; }
    get angle() { return this.ball.angle; }
    get sides() { return this.ball.sides; }

    draw(x, y) {
        this.sx = x; this.sy = y;
        node.drawGeneric(this);

        const xpos = this.sx + 36;
        const ypos = this.ball.subtitle ? this.sy - 3 : this.sy + 4;

        this.ctx.textAlign = "left"
        this.ctx.strokeStyle = "#000000";
        this.ctx.fillStyle = "#ffffff";
        this.ctx.lineWidth = node.getStrokeZoomed(4, this.camera.zoom);

        if (!this.ball.prefix) {
            node.drawText(this.ctx, this.ball.name, xpos, ypos);
        } else {
            const width = this.ctx.measureText(this.ball.prefix + " ").width;

            node.drawText(this.ctx, this.ball.name, xpos + width, ypos);
            this.ctx.fillStyle = "#ccff22";
            node.drawText(this.ctx, this.ball.prefix, xpos, ypos);
        }

        if (this.ball.subtitle) {
            this.ctx.fillStyle = "#7f7f7f";
            node.drawText(this.ctx, this.ball.subtitle, xpos, ypos + this.camera.fontSize + 2);
        }
    }
}