# Redesign relationship path view with fan-style ancestor layout

**What's changing**

The expanded relationship path (shown when you tap a relationship entry) will be redesigned to be more visually appealing with a fan-style branching layout that prevents overlapping.

**Design changes:**

- [x] **Fan-style branching from ancestor**: V-shaped fork with horizontal bar and center dot splitting to left/right branches
- [x] **Wider, better-spaced nodes**: Increased to 200px max width, more padding, rounded branch headers
- [x] **Curved connecting lines**: Fork connector with vertical stem, horizontal bar, and drop-down arrows
- [x] **Gradient connector lines**: Color transitions from green (ancestor) through mid tones to blue/pink (endpoints)
- [x] **Generation depth indicators**: Small "Gen 1", "Gen 2" badges on each node
- [x] **Highlighted endpoints**: Shadow/elevation glow effects + sparkle icon on compared people
- [x] **Ancestor crown enhancement**: Halo ring with subtle green glow around ancestor node
- [x] **Better horizontal scroll**: Horizontal ScrollView wrapping branch area
- [x] **Smooth reveal animation**: Staggered fade-in + scale animation from ancestor down to endpoints
