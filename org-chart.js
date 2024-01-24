/**
 * Creates an SVG DOM node.
 * @param {string} name Name of the element.
 * @param {Object} attrs Extra attributes to add to the node.
 * @returns {Node}
 */
function svgNode(name, attrs) {
    let n = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const attr in attrs) {
        n.setAttributeNS(null, attr, attrs[attr]);
    }
    return n;
}

/**
 * Creates a DOM node.
 * @param {string} name Name of the element.
 * @param {Object} attrs Extra attributes to add to the node.
 * @returns {Node}
 */
function node(name, attrs) {
    let n = document.createElement(name);
    for (const attr in attrs) {
        n.setAttribute(attr, attrs[attr]);
    }
    return n;
}

/**
 * Helper to apply an animation.
 *
 * @param {Node} el The element to apply the animation on.
 * @param {Object} keyframes The keyframes to apply. See
 *     https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API/Keyframe_Formats.
 * @param {Object} options The animation options. See
 *     https://developer.mozilla.org/en-US/docs/Web/API/Element/animate
 * @returns {Animation} The animation object.
 */
function animate(el, keyframes, options) {
    let animation = el.animate(keyframes, options);
    // The animation needs to be removed in order to be able to modify the
    // style again. This also helps with cleaning up resources.
    animation.onfinish = () => {
        animation.commitStyles();
        animation.cancel();
    };
    return animation;
}

/**
 * Map of all the `Team` objects, key is the team name.
 */
const TEAMS = {};

class Team {
    constructor(data) {
        // The slug name of the team.
        this.name = data.name;
        // The kind of team (team, working_group, project_group)
        this.kind = data.kind;
        // The slug name of the parent team, or null if no parent.
        this.parent_key = data.subteam_of;
        // The parent team instance, or null if no parent.
        this.parent = null;
        // Array of members straight from the raw JSON.
        this.members = data.members;
        this.members.sort((a, b) => {
            let ax = [!a.is_lead, a.name];
            let bx = [!b.is_lead, b.name];
            if (ax < bx) {
                return -1;
            } else if (ax > bx) {
                return 1;
            } else {
                return 0;
            }
        });

        // Whether or not this team is currently visible.
        this.visible = false;
        // Whether or not members are currently expanded.
        this.members_expanded = false;
        // Whether or not subteams are currently expanded.
        this.subteams_expanded = false;
        // Array of team objects that are direct subteams.
        this.subteams = [];
        // Array of team objects that also have subteams themselves.
        this.subteams_nested = [];
        // Array of team objects without subteams that show in the left column.
        this.subteam_leaves_left = [];
        // Array of team objects without subteams that show in the right column.
        this.subteam_leaves_right = [];
        // The <g> tag group container for this team.
        this.g = null;
        // The width of the name of the team text.
        this.name_length = 0;
        // The size of the team when members are not shown.
        this.collapsed_size = { width: 0, height: 0 };
        // The position of the team on the canvas.
        this.pos = { x: 0, y: 0 };
        // The current size of the team (changes when members are toggled).
        this.size = { width: 0, height: 0 };
        // The total width necessary for all subteams when they are expanded.
        this.subteam_width = 0;
        // The width of the subteam_leaves_left.
        this.leaf_left_width = 0;
        // The width of the subteam_leaves_right.
        this.leaf_right_width = 0;
        // The <path> element that contains a line to the parent. null if no parent.
        this.parent_line = null;
        // A string of the path line to the parent. null if no parent.
        this.parent_path = null;
    }

    /**
     * Position where branch points exit this node.
     */
    get branch_pos() {
        return {
            x: this.pos.x + this.size.width / 2,
            y: this.pos.y + this.size.height,
        };
    }

    /**
     * Adds a DOM node representing a team.
     * @param {Node} org_container The container where all <g> elements are added.
     */
    addTeamNode(org_container) {
        let kind = this.kind.replace("_", "-");
        let cls = `team-container team-members-collapsed team-subteams-collapsed kind-${kind}`;
        this.g = svgNode("g", {
            class: cls,
            id: this.name,
        });
        org_container.appendChild(this.g);

        // Add this first so that the size can be computed, then remove it.
        let team_name = svgNode("text", {
            class: "team-name",
        });
        team_name.textContent = this.name;
        this.g.appendChild(team_name);
        this.name_length = team_name.getComputedTextLength();
        this.collapsed_size = { width: this.name_length + 100, height: 60 };
        this.g.removeChild(team_name);
        org_container.removeChild(this.g);

        // Background
        let team_background = svgNode("rect", {
            rx: 30,
            class: "team-background",
        });
        this.g.appendChild(team_background);
        this.g.appendChild(team_name);

        // Member count
        let member_count = svgNode("g", {
            class: "team-member-count",
        });
        this.g.appendChild(member_count);
        let member_count_button = svgNode("rect", {
            class: "team-member-count-background",
            rx: 8,
        });
        member_count_button.onclick = (e) => {
            this.toggleMemberExpand();
        };
        member_count.appendChild(member_count_button);
        let member_count_text = svgNode("text", {
            class: "team-member-count-text",
        });
        member_count_text.textContent = `${this.members.length}`;
        member_count.appendChild(member_count_text);

        if (this.parent != null) {
            // The path will be defined during layout since it will change.
            this.parent_line = svgNode("path", { class: "link-line" });
            this.g.appendChild(this.parent_line);
        }

        // Subteam count
        if (this.subteams.length > 0) {
            let subteam_toggle = svgNode("g", { class: "team-subteam-toggle" });
            this.g.appendChild(subteam_toggle);

            let toggle_button = svgNode("rect", {
                class: "team-subteam-toggle-background",
                rx: 8,
            });
            toggle_button.onclick = (e) => {
                this.toggleSubteams();
            };
            subteam_toggle.appendChild(toggle_button);

            let subteam_toggle_chevron = svgNode("polyline", {
                class: "team-subteam-toggle-chevron",
                points: "0,0 6,6 12,0",
            });
            subteam_toggle.appendChild(subteam_toggle_chevron);

            let subteam_toggle_count = svgNode("text", {
                class: "team-subteam-toggle-text",
            });
            subteam_toggle_count.textContent = `${this.subteams.length}`;
            subteam_toggle.appendChild(subteam_toggle_count);
        }

        // Team members
        for (var n = 0; n < this.members.length; n++) {
            let member = this.members[n];
            let cls = "team-member";
            if (member.is_lead) {
                cls += " lead";
            }
            let member_container = svgNode("g", {
                class: cls,
            });
            let member_x = 10 + (n % 2) * 220;
            let member_y = 35 + Math.trunc(n / 2) * 70;
            member_container.style[
                "transform"
            ] = `translate(${member_x}px, ${member_y}px) scale(1)`;
            this.g.appendChild(member_container);
            member.container = member_container;

            let member_bg = svgNode("rect", {
                class: "team-member-background",
                width: 200,
                height: 60,
                rx: 30,
            });
            member_container.appendChild(member_bg);

            let img = svgNode("image", {
                href: `https://avatars.githubusercontent.com/u/${member.github_id}?v=4`,
                class: "member-img",
            });
            member_container.appendChild(img);

            let member_name = svgNode("text", { class: "member-name" });
            member_name.textContent = member.name;
            member_container.appendChild(member_name);

            let github = svgNode("text", { class: "member-github" });
            github.textContent = member.github;
            member_container.appendChild(github);
        }

        this.layout();
        this.g.style["visibility"] = "hidden";
        org_container.appendChild(this.g);
    }

    /**
     * Sets the position of the team, forcing it to be visible, with animation.
     */
    setPos(x, y, delay) {
        if (!this.visible || this.pos.x != x || this.pos.y != y) {
            this.g.style["visibility"] = "visible";
            this.pos = { x: x, y: y };
            let actual_delay = 0;
            let p = this.parent.branch_pos;
            if (!this.visible) {
                // This subteam is coming into view, animate it into position.
                // FIXME: This is broken on Safari, the animation starts from 0,0. Don't know why.
                // FIXME: This starting position looks weird if you have a
                // nested subteam expanded, then collapse the parent, then
                // re-open the parent.
                this.g.style[
                    "transform"
                ] = `translate(${p.x}px, ${p.y}px) scale(0)`;
                actual_delay = delay * 50 + 100;
            }
            animate(
                this.g,
                {
                    transform: [`translate(${x}px, ${y}px) scale(1)`],
                },
                {
                    fill: "forwards",
                    easing: "ease",
                    delay: actual_delay,
                    duration: 400,
                },
            );
            this.visible = true;
        }
    }

    /**
     * Computes the layout of this team (but not its subteams).
     */
    layout() {
        let background = this.g.querySelector(".team-background");
        let team_name = this.g.querySelector(".team-name");
        let member_count = this.g.querySelector(".team-member-count");
        let subteam_toggle = this.g.querySelector(".team-subteam-toggle");
        if (this.members_expanded) {
            let bg_width = this.members.length > 1 ? 440 : 220;
            let bg_height = Math.ceil(this.members.length / 2) * 70 + 40;
            this.size = { width: bg_width, height: bg_height };
            background.setAttribute("width", bg_width);
            background.setAttribute("height", bg_height);
            member_count.style["transform"] = `translate(${
                bg_width - 50
            }px, 6px)`;
            team_name.style["transform"] = `translate(20px, 20px)`;
            if (subteam_toggle != null) {
                subteam_toggle.style["transform"] = `translate(${
                    bg_width / 2 - 20
                }px, ${bg_height - 8}px)`;
            }
        } else {
            let bg_width = this.collapsed_size.width;
            this.size = this.collapsed_size;
            background.setAttribute("width", this.collapsed_size.width);
            background.setAttribute("height", this.collapsed_size.height);
            member_count.style["transform"] = `translate(${
                bg_width - 50
            }px, 6px)`;
            team_name.style["transform"] = `translate(${
                bg_width / 2 - this.name_length / 2
            }px, 35px)`;
            if (subteam_toggle != null) {
                subteam_toggle.style["transform"] = `translate(${
                    bg_width / 2 - 20
                }px, 52px)`;
            }
        }
    }

    /**
     * Animates the viewport to center on this team.
     */
    centerOnSelf(animated) {
        ORG_CHART_GV.translateToCenterXY(
            this.pos.x + this.size.width / 2,
            this.pos.y + this.size.height / 2 + 100,
            animated,
        );
    }

    /**
     * Toggles viewing the team members.
     */
    toggleMemberExpand() {
        this.members_expanded = !this.members_expanded;

        let background = this.g.querySelector(".team-background");
        let team_name = this.g.querySelector(".team-name");
        let member_count = this.g.querySelector(".team-member-count");
        let subteam_toggle = this.g.querySelector(".team-subteam-toggle");
        if (this.members_expanded) {
            let bg_width = this.members.length > 1 ? 440 : 220;
            let bg_height = Math.ceil(this.members.length / 2) * 70 + 40;
            this.size = { width: bg_width, height: bg_height };
            background.setAttribute("width", bg_width);
            background.setAttribute("height", bg_height);
            member_count.style["transform"] = `translate(${
                bg_width - 50
            }px, 6px)`;
            team_name.style["transform"] = `translate(20px, 20px)`;
            if (subteam_toggle != null) {
                subteam_toggle.style["transform"] = `translate(${
                    bg_width / 2 - 20
                }px, ${bg_height - 8}px)`;
            }
        } else {
            let bg_width = this.collapsed_size.width;
            this.size = this.collapsed_size;
            background.setAttribute("width", this.collapsed_size.width);
            background.setAttribute("height", this.collapsed_size.height);
            member_count.style["transform"] = `translate(${
                bg_width - 50
            }px, 6px)`;
            team_name.style["transform"] = `translate(${
                bg_width / 2 - this.name_length / 2
            }px, 35px)`;
            if (subteam_toggle != null) {
                subteam_toggle.style["transform"] = `translate(${
                    bg_width / 2 - 20
                }px, 52px)`;
            }
        }

        for (var n = 0; n < this.members.length; n++) {
            const member = this.members[n];
            let xform = member.container.style["transform"];
            xform = xform.replace(/ *scale\(.*?\)/, "");
            if (this.members_expanded) {
                member.container.style["visibility"] = "visible";
                member.container.style["transform"] = xform + " scale(0)";
                let scales = [0, 1.22, 0.87, 1.05, 0.98, 1.01, 1, 1].map(
                    (x) => xform + ` scale(${x})`,
                );
                animate(
                    member.container,
                    {
                        transform: scales,
                        offset: [0, 0.16, 0.28, 0.44, 0.59, 0.73, 0.88, 1],
                    },
                    {
                        fill: "forwards",
                        delay: n * 50 + 100,
                        duration: 400,
                    },
                );
            } else {
                // This animation could be better.
                animate(
                    member.container,
                    {
                        transform: xform + " scale(0)",
                    },
                    {
                        fill: "forwards",
                        duration: 200,
                    },
                );
            }
        }
        this.g.classList.toggle("team-members-expanded");
        this.g.classList.toggle("team-members-collapsed");
        layoutAllTeams();
        this.centerOnSelf(true);
    }

    /**
     * Toggles viewing the subteams.
     */
    toggleSubteams() {
        this.subteams_expanded = !this.subteams_expanded;
        this.g.classList.toggle("team-subteams-expanded");
        this.g.classList.toggle("team-subteams-collapsed");
        layoutAllTeams();
        if (this.subteams_expanded) {
            ORG_CHART_GV.translateToCenterX(
                this.pos.x + this.size.width / 2,
                -this.pos.y + 60,
                true,
            );
        } else {
            for (const subteam of this.subteams) {
                subteam.hide(this.branch_pos);
            }
        }
    }

    /**
     * Hides this team when subteams are collapsed.
     * @param {object} hide_pos The x/y position where to animate the collapse.
     */
    hide(hide_pos) {
        this.visible = false;
        let animation = animate(
            this.g,
            {
                transform: [
                    `translate(${hide_pos.x}px, ${hide_pos.y}px) scale(0)`,
                ],
            },
            {
                fill: "forwards",
                easing: "ease",
                // delay: actual_delay,
                duration: 400,
            },
        );
        // Safari does not seem to treat scale(0) elements as being hidden,
        // which prevents click handlers from working (because invisible
        // elements are in the way). Set visibility after animation to fix
        // this.
        let onfinish = animation.onfinish;
        animation.onfinish = () => {
            this.g.style["visibility"] = "hidden";
            onfinish();
        };
        for (const subteam of this.subteams) {
            subteam.hide(hide_pos);
        }
        for (const member of this.members) {
            member.container.style["visibility"] = "hidden";
        }
    }

    /**
     * Positions and shows/hides all subteams of this team (recursively).
     *
     * Assumes that `computeSubteamWidth` has been called for all subteams.
     */
    layoutSubteams() {
        if (this.subteams_expanded) {
            // Position for the first subteam on the left.
            let x = this.pos.x - this.subteam_width / 2 + this.size.width / 2;
            let y = this.pos.y + this.size.height + 60;
            let sequence = 0;
            for (const subteam of this.subteams_nested) {
                // When a subteam is expanded, position so this is in the center.
                let sub_width = Math.max(
                    subteam.size.width,
                    subteam.subteam_width,
                );
                let expanded_offset = subteam.subteams_expanded
                    ? sub_width / 2 - subteam.size.width / 2
                    : 0;
                subteam.setPos(x + expanded_offset, y, sequence);
                sequence += 1;
                x += Math.max(subteam.size.width, subteam.subteam_width) + 10;
            }
            let left_y = y;
            for (const left of this.subteam_leaves_left) {
                left.setPos(
                    x + this.leaf_left_width - left.size.width,
                    left_y,
                    sequence,
                );
                sequence += 1;
                left_y += left.size.height + 10;
            }
            let right_y = y;
            x += this.leaf_left_width + 30;
            for (const right of this.subteam_leaves_right) {
                right.setPos(x, right_y, sequence);
                sequence += 1;
                right_y += right.size.height + 10;
            }
            this.setSubteamPaths();
            for (const subteam of this.subteams) {
                if (subteam.members_expanded) {
                    for (const member of subteam.members) {
                        member.container.style["visibility"] = "visible";
                    }
                }
            }
            for (const subteam of this.subteams_nested) {
                subteam.layoutSubteams();
            }
        }
    }

    /**
     * Computes the paths for the lines connecting subteams.
     */
    setSubteamPaths() {
        let sequence = 0;
        for (const subteam of this.subteams_nested) {
            this.setSubteamPathFromTop(subteam, sequence);
            sequence += 1;
        }
        if (this.subteam_leaves_right.length > 0) {
            // Draw both left and right leaves.

            // Determine the widest subteam on the left to know how far
            // away we are from the parent.
            let widest_subteam = this.subteam_leaves_left[0];
            for (const subteam of this.subteam_leaves_left) {
                if (subteam.size.width > widest_subteam.size.width) {
                    widest_subteam = subteam;
                }
            }
            // X distance between where the line comes up.
            let vertical_x =
                widest_subteam.pos.x + widest_subteam.size.width + 15;
            let p_pos = this.branch_pos;
            let diff = Math.abs(p_pos.x - vertical_x);
            for (const [index, subteam] of this.subteam_leaves_left.entries()) {
                let d;
                let height = this.subteam_leaves_left
                    .slice(0, index)
                    .map((t) => t.size.height + 10)
                    .reduce((a, b) => a + b, 0);
                height += subteam.size.height / 2 - 20;
                if (p_pos.x > vertical_x) {
                    if (diff > 60) {
                        d = `M ${subteam.size.width} ${
                            subteam.size.height / 2
                        } \
                             c 15 0 15 -10 15 -30 \
                             v ${-height} \
                             c 0 -10 0 -20 30 -20 \
                             h ${
                                 p_pos.x -
                                 widest_subteam.pos.x -
                                 widest_subteam.size.width -
                                 75
                             } \
                             c 30 0 30 -10 30 -20 \
                             v -2`;
                    } else {
                        d = `M ${subteam.size.width} ${
                            subteam.size.height / 2
                        } \
                             c 15 0 15 -10 15 -30 \
                             v ${-height} \
                             c 0 -10 0 -20 ${diff / 2} -20 \
                             c ${diff / 2} 0 ${diff / 2} -10 ${diff / 2} -20 \
                             v -2`;
                    }
                } else {
                    if (diff > 60) {
                        d = `M ${subteam.size.width} ${
                            subteam.size.height / 2
                        } \
                             c 15 0 15 -10 15 -30 \
                             v ${-height} \
                             c 0 -10 0 -20 -30 -20 \
                             h ${
                                 p_pos.x -
                                 widest_subteam.pos.x -
                                 widest_subteam.size.width +
                                 45
                             } \
                             c -30 0 -30 -10 -30 -20 \
                             v -2`;
                    } else {
                        d = `M ${subteam.size.width} ${
                            subteam.size.height / 2
                        } \
                             c 15 0 15 -10 15 -30 \
                             v ${-height} \
                             c 0 -10 0 -20 ${-diff / 2} -20 \
                             c ${-diff / 2} 0 ${-diff / 2} -10 ${
                            -diff / 2
                        } -20 \
                             v -2`;
                    }
                }
                subteam.animateParentLine(d, sequence);
                sequence += 1;
            }
            for (const [
                index,
                subteam,
            ] of this.subteam_leaves_right.entries()) {
                let d;
                let height =
                    this.subteam_leaves_right
                        .slice(0, index)
                        .map((t) => t.size.height + 10)
                        .reduce((a, b) => a + b, 0) + 10;
                height += subteam.size.height / 2 - 30;
                if (p_pos.x > vertical_x) {
                    if (diff > 60) {
                        d = `M 0 ${subteam.size.height / 2} \
                                 c -15 0 -15 -10 -15 -30 \
                                 v ${-height} \
                                 c 0 -10 0 -20 30 -20 \
                                 h ${
                                     p_pos.x -
                                     widest_subteam.pos.x -
                                     widest_subteam.size.width -
                                     75
                                 } \
                                 c 30 0 30 -10 30 -20 \
                                 v -2`;
                    } else {
                        d = `M 0 ${subteam.size.height / 2} \
                             c -15 0 -15 -10 -15 -30 \
                             v ${-height} \
                             c 0 -10 0 -20 ${diff / 2} -20 \
                             c ${diff / 2} 0 ${diff / 2} -10 ${diff / 2} -20 \
                             v -2`;
                    }
                } else {
                    if (diff > 60) {
                        d = `M 0 ${subteam.size.height / 2} \
                                 c -15 0 -15 -10 -15 -30 \
                                 v ${-height} \
                                 c 0 -10 0 -20 -30 -20 \
                                 h ${
                                     p_pos.x -
                                     widest_subteam.pos.x -
                                     widest_subteam.size.width +
                                     45
                                 } \
                                 c -30 0 -30 -10 -30 -20 \
                                 v -2`;
                    } else {
                        d = `M 0 ${subteam.size.height / 2} \
                             c -15 0 -15 -10 -15 -30 \
                             v ${-height} \
                             c 0 -10 0 -20 ${-diff / 2} -20 \
                             c ${-diff / 2} 0 ${-diff / 2} -10 ${
                            -diff / 2
                        } -20 \
                             v -2`;
                    }
                }
                subteam.animateParentLine(d, sequence);
                sequence += 1;
            }
        } else if (this.subteam_leaves_left.length == 1) {
            this.setSubteamPathFromTop(this.subteam_leaves_left[0], sequence);
        }
    }

    /**
     * Helper to compute the path coming out of the top of the subteam to its
     * parent.
     */
    setSubteamPathFromTop(subteam, sequence) {
        let d;
        let subteam_x = subteam.pos.x + subteam.size.width / 2;
        let p_pos = this.branch_pos;
        let diff = Math.abs(p_pos.x - subteam_x);
        if (p_pos.x > subteam_x) {
            // Subteam is to the left.
            if (diff > 60) {
                d = `M ${subteam.size.width / 2} 0 \
                     v -10 \
                     c 0 -10 0 -20 30 -20 \
                     h ${
                         p_pos.x - subteam.pos.x - subteam.size.width / 2 - 60
                     } \
                     c 30 0 30 -10 30 -20 \
                     v -2`;
            } else {
                // Subteam is nearly directly below the parent, so its
                // curves are smaller.
                d = `M ${subteam.size.width / 2} 0 \
                     v -10 \
                     c 0 -10 0 -20 ${diff / 2} -20 \
                     c ${diff / 2} 0 ${diff / 2} -10 ${diff / 2} -20 \
                     v -2`;
            }
        } else {
            // Subteam is to the right.
            if (diff > 60) {
                d = `M ${subteam.size.width / 2} 0 \
                     v -10 \
                     c 0 -10 0 -20 -30 -20 \
                     h ${
                         p_pos.x - subteam.pos.x - subteam.size.width / 2 + 60
                     } \
                     c -30 0 -30 -10 -30 -20 \
                     v -2`;
            } else {
                // Subteam is nearly directly below the parent, so its
                // curves are smaller.
                d = `M ${subteam.size.width / 2} 0 \
                     v -10 \
                     c 0 -10 0 -20 ${-diff / 2} -20 \
                     c ${-diff / 2} 0 ${-diff / 2} -10 ${-diff / 2} -20 \
                     v -2`;
            }
        }
        subteam.animateParentLine(d, sequence);
    }

    /**
     * Helper to apply an animation to the parent line path.
     */
    animateParentLine(new_path, delay) {
        if (!this.visible || this.parent_path != new_path) {
            this.parent_path = new_path;
            let actual_delay = 0;
            if (!CSS.supports("d: path('')")) {
                // Safari does not support CSS animated paths.
                this.parent_line.setAttribute("d", new_path);
                return;
            }
            if (!this.visible) {
                // This subteam is coming into view for the first time,
                // animate it into display.
                // FIXME: This sometimes animates weird on Firefox and Chrome.
                // I wonder if it would be better to have a path that has the
                // same "shape" as the destination, with zero-length values?
                // FIXME: See setPos for problem with Safari.
                this.parent_line.style["d"] = "path('')";
                actual_delay = delay * 50 + 100;
            }
            animate(
                this.parent_line,
                {
                    d: [`path('${new_path}')`],
                },
                {
                    fill: "forwards",
                    easing: "ease",
                    delay: actual_delay,
                    duration: 400,
                },
            );
        }
    }

    /**
     * Computes the width of all subteams for this team (recursively).
     *
     * Stores:
     * - `subteam_width`
     * - `leaf_left_width`
     * - `leaf_right_width`
     */
    computeSubteamWidth() {
        if (this.subteams_expanded) {
            for (const subteam of this.subteams) {
                subteam.computeSubteamWidth();
            }
            this.subteam_width = this.subteams_nested
                .map((t) => Math.max(t.size.width, t.subteam_width))
                .reduce((a, b) => a + b, 0);
            this.leaf_left_width = Math.max(
                ...this.subteam_leaves_left.map((t) => t.size.width),
                0,
            );
            this.leaf_right_width = Math.max(
                ...this.subteam_leaves_right.map((t) => t.size.width),
                0,
            );
            this.subteam_width += this.leaf_left_width + this.leaf_right_width;
            let left_column = this.subteam_leaves_left.length > 0 ? 1 : 0;
            let right_column = this.subteam_leaves_right.length > 0 ? 1 : 0;
            let total_columns =
                this.subteams_nested.length + left_column + right_column;
            // Add spacing between columns.
            this.subteam_width += (total_columns - 1) * 10;
            if (this.leaf_right_width > 0) {
                // More space between the leaf columns.
                this.subteam_width += 20;
            }
        } else {
            this.subteam_width = 0;
        }
    }
}

/**
 * Initializes the TEAMS data, and sets up the initial root DOM noes.
 */
function initialize() {
    // TODO: Fix in team repo.
    RAW_TEAMS["devtools"].subteam_of = "leadership-council";
    RAW_TEAMS["crates-io"].subteam_of = "leadership-council";
    RAW_TEAMS["lang"].subteam_of = "leadership-council";
    RAW_TEAMS["compiler"].subteam_of = "leadership-council";
    RAW_TEAMS["mods"].subteam_of = "leadership-council";
    RAW_TEAMS["infra"].subteam_of = "leadership-council";
    RAW_TEAMS["libs"].subteam_of = "leadership-council";

    // Should be archived.
    delete RAW_TEAMS["core"];

    // TODO: launching-pad
    RAW_TEAMS["launching-pad"] = {
        name: "launching-pad",
        kind: "team",
        subteam_of: "leadership-council",
        members: [],
    };
    RAW_TEAMS["community"].subteam_of = "launching-pad";
    RAW_TEAMS["docker"].subteam_of = "launching-pad";
    RAW_TEAMS["twir"].subteam_of = "launching-pad";
    RAW_TEAMS["web-presence"].subteam_of = "launching-pad";
    RAW_TEAMS["wg-async"].subteam_of = "launching-pad";
    RAW_TEAMS["wg-cli"].subteam_of = "launching-pad";
    RAW_TEAMS["wg-embedded"].subteam_of = "launching-pad";
    RAW_TEAMS["wg-gamedev"].subteam_of = "launching-pad";
    RAW_TEAMS["wg-rust-by-example"].subteam_of = "launching-pad";
    RAW_TEAMS["wg-secure-code"].subteam_of = "launching-pad";
    RAW_TEAMS["wg-security-response"].subteam_of = "launching-pad";
    RAW_TEAMS["wg-wasm"].subteam_of = "launching-pad";
    RAW_TEAMS["wg-triage"].subteam_of = "launching-pad";

    initTeams();
    let lc = TEAMS["leadership-council"];
    let container = document.getElementById("org-container");
    for (const team of Object.values(TEAMS)) {
        team.addTeamNode(container);
    }
    lc.visible = true;
    lc.g.style["visibility"] = "visible";
    lc.centerOnSelf(false);
    createStats();
}

/** Updates the `TEAMS` global with fields needed for rendering. */
function initTeams() {
    for (const team of Object.values(RAW_TEAMS)) {
        TEAMS[team.name] = new Team(team);
    }
    linkSubteams();
}

/**
 * Updates the `subteams`, `subteam_leaves_left`, and `subteam_leaves_right`
 * properties to each team which is an array of teams that are direct
 * descendants.
 */
function linkSubteams() {
    for (const [key, team] of Object.entries(TEAMS)) {
        if (team.parent_key != null) {
            team.parent = TEAMS[team.parent_key];
            team.parent.subteams.push(team);
        }
    }
    for (const team of Object.values(TEAMS)) {
        team.subteams.sort((a, b) => {
            if (a.kind == b.kind) {
                return a.name.localeCompare(b.name);
            }
            let k = (k) => {
                switch (k) {
                    case "team":
                        return 0;
                    case "project_group":
                        return 1;
                    case "working_group":
                        return 2;
                    default:
                        return 3;
                }
            };
            return k(a.kind) - k(b.kind);
        });
        team.subteams_nested = team.subteams.filter(
            (t) => t.subteams.length > 0,
        );
        const leaves = team.subteams.filter((t) => t.subteams.length == 0);
        for (var n = 0; n < leaves.length; n++) {
            if (n % 2 == 0) {
                team.subteam_leaves_left.push(leaves[n]);
            } else {
                team.subteam_leaves_right.push(leaves[n]);
            }
        }
    }
}

/**
 * Computes the layout of all teams.
 */
function layoutAllTeams() {
    let lc = TEAMS["leadership-council"];
    lc.computeSubteamWidth();
    lc.layoutSubteams();
}

class GlobalViewport {
    static MIN_SCALE = 0.3;
    static MAX_SCALE = 4;
    static ZOOM_SPEED = 0.01;

    constructor() {
        this.background = document.querySelector("#org-svg");
        this.container = document.querySelector("#org-container");
        this.transform = { x: 0, y: 0, scale: 1 };
        this.translate_start_pos = { x: 0, y: 0 };
        this.mouse_start_pos = { x: 0, y: 0 };
        // The current animation.
        this.animation = null;
    }

    addEventListeners() {
        this.background.addEventListener("mousedown", GlobalViewport.onDown);
        this.background.addEventListener("wheel", GlobalViewport.onWheel);
        this.background.addEventListener("touchstart", (e) => {
            ORG_CHART_GV.mouse_start_pos = ORG_CHART_GV.adjustedPos(
                e.touches[0],
            );
            ORG_CHART_GV.translate_start_pos = {
                x: ORG_CHART_GV.transform.x,
                y: ORG_CHART_GV.transform.y,
            };
        });
        this.background.addEventListener("touchmove", (e) => {
            // TODO: If there are two touches, then it should use the midpoint between them.
            e.preventDefault();
            e.stopPropagation();
            let pos = ORG_CHART_GV.adjustedPos(e.touches[0]);
            ORG_CHART_GV.drag(pos.x, pos.y);
        });
        this.background.addEventListener("gesturechange", (e) => {
            // TODO: This is pretty buggy.
            ORG_CHART_GV.transform.scale = Math.max(
                Math.min(e.scale, GlobalViewport.MAX_SCALE),
                GlobalViewport.MIN_SCALE,
            );
            ORG_CHART_GV.setTransform();
        });
    }

    setTransform() {
        if (this.animation != null) {
            this.animation.cancel();
            this.animation = null;
        }
        this.container.style["transform"] = this.getTransform();
    }

    getTransform() {
        return `translate(${this.transform.x}px, ${this.transform.y}px) scale(${this.transform.scale})`;
    }

    displayRect() {
        return this.background.getBoundingClientRect();
    }

    adjustedPos(e) {
        let rect = this.displayRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    drag(x, y) {
        this.transform.x =
            this.translate_start_pos.x + x - this.mouse_start_pos.x;
        this.transform.y =
            this.translate_start_pos.y + y - this.mouse_start_pos.y;
        this.setTransform();
    }

    translateToCenterXY(x, y, animated) {
        let rect = this.displayRect();
        this.transform.x = rect.width / 2 - x * this.transform.scale;
        this.transform.y = rect.height / 2 - y * this.transform.scale;
        this.#translate(animated);
    }

    translateToCenterX(x, y, animated) {
        let rect = this.displayRect();
        this.transform.x = rect.width / 2 - x * this.transform.scale;
        this.transform.y = y * this.transform.scale;
        this.#translate(animated);
    }

    #translate(animated) {
        if (animated) {
            this.animation = animate(
                this.container,
                {
                    transform: [this.getTransform()],
                },
                {
                    fill: "forwards",
                    easing: "ease",
                    duration: 300,
                },
            );
        } else {
            this.setTransform();
        }
    }

    static onDrag(e) {
        let pos = ORG_CHART_GV.adjustedPos(e);
        ORG_CHART_GV.drag(pos.x, pos.y);
    }

    static onUp() {
        document.removeEventListener("mousemove", GlobalViewport.onDrag);
        document.removeEventListener("mouseup", GlobalViewport.onUp);
    }

    static onDown(e) {
        if (e.button == 0) {
            ORG_CHART_GV.mouse_start_pos = ORG_CHART_GV.adjustedPos(e);
            ORG_CHART_GV.translate_start_pos = {
                x: ORG_CHART_GV.transform.x,
                y: ORG_CHART_GV.transform.y,
            };
            document.addEventListener("mousemove", GlobalViewport.onDrag);
            document.addEventListener("mouseup", GlobalViewport.onUp);
        }
    }

    zoom(e) {
        // TODO: backwards
        e.preventDefault();
        e.stopPropagation();
        let delta;
        switch (e.deltaMode) {
            case WheelEvent.DOM_DELTA_PIXEL:
                delta = -e.deltaY;
                break;
            default:
                delta = -e.deltaY * 16;
                break;
        }
        delta *= GlobalViewport.ZOOM_SPEED;
        let new_scale = this.transform.scale * (delta + 1);
        if (
            new_scale > GlobalViewport.MAX_SCALE ||
            new_scale < GlobalViewport.MIN_SCALE
        ) {
            return;
        }
        this.transform.scale = new_scale;
        let pos = this.adjustedPos(e);
        let deltaX = this.transform.x - pos.x;
        let deltaY = this.transform.y - pos.y;
        this.transform.x += (1 + delta) * deltaX - deltaX;
        this.transform.y += (1 + delta) * deltaY - deltaY;
        this.setTransform();
    }

    static onWheel(e) {
        return ORG_CHART_GV.zoom(e);
    }
}

function createStats() {
    let teams = Object.values(RAW_TEAMS);
    let total_people = new Set(
        teams.flatMap((t) => t.members).map((m) => m.name),
    ).size;
    let total_team_members = new Set(
        teams
            .filter((t) => t.kind == "team")
            .flatMap((t) => t.members)
            .map((m) => m.name),
    ).size;
    let total_org_units = teams.length;
    let total_teams = teams.filter((t) => t.kind == "team").length;
    let total_wgs = teams.filter((t) => t.kind == "working_group").length;
    let total_pgs = teams.filter((t) => t.kind == "project_group").length;
    let table = document.querySelector("#stats table");
    let add_row = (label, value) => {
        let row = table.insertRow();
        let cell = row.insertCell();
        cell.textContent = label;
        cell = row.insertCell();
        cell.textContent = value;
    };
    add_row("Total people", total_people);
    add_row("Total team members", total_team_members);
    add_row("Total org units", total_org_units);
    add_row("Total teams", total_teams);
    add_row("Total working groups", total_wgs);
    add_row("Total project groups", total_pgs);
}

{
    ORG_CHART_GV = new GlobalViewport();
    initialize();
    ORG_CHART_GV.addEventListeners();
}
