/**
 * Console commands for testing spirit effects on tokens
 * Usage: Copy and paste these functions into the browser console
 */

/**
 * Debug PIXI filters availability
 * Usage: debugPIXIFilters()
 */
window.debugPIXIFilters = function() {
    console.log('fa-token-browser | Debugging PIXI filters...');
    console.log('PIXI version:', PIXI.VERSION);
    console.log('PIXI.filters:', PIXI.filters);
    console.log('PIXI.ColorMatrixFilter:', PIXI.ColorMatrixFilter);
    console.log('PIXI.GlowFilter:', PIXI.GlowFilter);
    console.log('PIXI.BlurFilter:', PIXI.BlurFilter);
    
    if (PIXI.filters) {
        console.log('Available filters in PIXI.filters:', Object.keys(PIXI.filters));
    }
    
    // Check selected token structure
    const controlled = canvas.tokens.controlled;
    if (controlled.length > 0) {
        const token = controlled[0];
        console.log('Token object:', token);
        console.log('Token.mesh:', token.mesh);
        console.log('Token.sprite:', token.sprite);
        console.log('Token.texture:', token.texture);
        console.log('Token.mesh.texture:', token.mesh?.texture);
    }
};

/**
 * Apply spirit effect to currently selected token(s)
 * Usage: applySpiritEffect()
 */
window.applySpiritEffect = function() {
    const controlled = canvas.tokens.controlled;
    
    if (controlled.length === 0) {
        console.warn('fa-token-browser | No tokens selected. Please select a token first.');
        return;
    }
    
    controlled.forEach(token => {
        try {
            console.log('fa-token-browser | Applying spirit effect to token:', token.name);
            
            // Get the PIXI sprite object
            const sprite = token.mesh;
            if (!sprite) {
                console.error('fa-token-browser | No sprite found for token:', token.name);
                return;
            }
            
            // Apply spirit transparency (75% opacity for more authentic look)
            sprite.alpha = 0.75;
            
            // Create authentic spirit effect filter stack
            const filters = [];
            
            // 1. Color Matrix Filter for desaturation and cool tint
            const ColorMatrixFilter = PIXI.ColorMatrixFilter || PIXI.filters?.ColorMatrixFilter;
            if (ColorMatrixFilter) {
                const colorMatrix = new ColorMatrixFilter();
                
                // Turquoise/cyan transformation - more green in the blue for cyan effect
                colorMatrix.matrix = [
                    0.1, 0.1, 0.1, 0.0, 0.0,   // Red channel (minimal)
                    0.3, 0.3, 0.3, 0.0, 0.1,   // Green channel (more for cyan/turquoise)
                    0.4, 0.4, 0.8, 0.0, 0.3,   // Blue channel (strong but not overwhelming)
                    0.0, 0.0, 0.0, 1.0, 0.0    // Alpha channel
                ];
                
                filters.push(colorMatrix);
                console.log('fa-token-browser | Color matrix filter added');
            } else {
                console.warn('fa-token-browser | ColorMatrixFilter not available');
            }
            
            // 2. Apply color filters to main sprite (no blur on main sprite)
            console.log('fa-token-browser | Color filters applied to main sprite');
            
            sprite.filters = filters;
            
            // 3. Create glow effect by adding a blurred copy behind the sprite
            try {
                // Create a glow sprite as a copy of the original
                const glowSprite = new PIXI.Sprite(sprite.texture);
                glowSprite.anchor.set(0.5);
                glowSprite.position.set(sprite.width / 2, sprite.height / 2);
                glowSprite.scale.set(1.3); // Larger for glow effect
                glowSprite.alpha = 0.4;
                glowSprite.tint = 0x00CCCC; // Turquoise tint for glow
                
                // Apply heavy blur and color to the glow sprite only
                const glowBlur = new PIXI.BlurFilter(10);
                const glowColorMatrix = new PIXI.ColorMatrixFilter();
                
                // Make glow more turquoise/cyan
                glowColorMatrix.matrix = [
                    0.0, 0.0, 0.0, 0.0, 0.0,   // No red
                    0.5, 0.5, 0.5, 0.0, 0.3,   // Green from luminance
                    0.5, 0.5, 0.5, 0.0, 0.5,   // Blue from luminance
                    0.0, 0.0, 0.0, 1.0, 0.0    // Alpha
                ];
                
                glowSprite.filters = [glowBlur, glowColorMatrix];
                
                // Add glow sprite behind the main sprite
                const parent = sprite.parent;
                if (parent) {
                    const spriteIndex = parent.getChildIndex(sprite);
                    parent.addChildAt(glowSprite, spriteIndex);
                    
                    // Store reference for cleanup
                    sprite._spiritGlow = glowSprite;
                    console.log('fa-token-browser | Turquoise glow effect added behind main sprite');
                }
            } catch (glowError) {
                console.warn('fa-token-browser | Could not create glow effect:', glowError);
            }
            
            // Mark token as spirit in flags for persistence and store alpha
            token.document.setFlag('fa-token-browser', 'isSpirit', true);
            token.document.setFlag('fa-token-browser', 'spiritAlpha', 0.75);
            
            console.log('fa-token-browser | Spirit effect applied to:', token.name, 'with', filters.length, 'filters');
            
        } catch (error) {
            console.error('fa-token-browser | Error applying spirit effect:', error);
        }
    });
};

/**
 * Remove spirit effect from currently selected token(s)
 * Usage: removeSpiritEffect()
 */
window.removeSpiritEffect = function() {
    const controlled = canvas.tokens.controlled;
    
    if (controlled.length === 0) {
        console.warn('fa-token-browser | No tokens selected. Please select a token first.');
        return;
    }
    
    controlled.forEach(token => {
        try {
            console.log('fa-token-browser | Removing spirit effect from token:', token.name);
            
            // Get the PIXI sprite object
            const sprite = token.mesh || token.sprite;
            if (!sprite) {
                console.error('fa-token-browser | No sprite found for token:', token.name);
                return;
            }
            
            // Reset transparency
            sprite.alpha = 1.0;
            
            // Remove filters
            sprite.filters = null;
            
            // Remove glow sprite if it exists
            if (sprite._spiritGlow) {
                const parent = sprite.parent;
                if (parent && parent.children.includes(sprite._spiritGlow)) {
                    parent.removeChild(sprite._spiritGlow);
                }
                sprite._spiritGlow = null;
                console.log('fa-token-browser | Glow effect removed');
            }
            
            // Remove spirit flag
            token.document.unsetFlag('fa-token-browser', 'isSpirit');
            
            console.log('fa-token-browser | Spirit effect removed from:', token.name);
            
        } catch (error) {
            console.error('fa-token-browser | Error removing spirit effect:', error);
        }
    });
};

/**
 * Add floating particles to selected token(s)
 * Usage: addSpiritParticles()
 */
window.addSpiritParticles = function() {
    const controlled = canvas.tokens.controlled;
    
    if (controlled.length === 0) {
        console.warn('fa-token-browser | No tokens selected. Please select a token first.');
        return;
    }
    
    controlled.forEach(token => {
        try {
            console.log('fa-token-browser | Adding spirit particles to token:', token.name);
            
            // Create particle container
            const particleContainer = new PIXI.Container();
            particleContainer.name = 'spiritParticles';
            
            // Add to token's parent container
            token.addChild(particleContainer);
            
            // Position particle container at token center
            particleContainer.position.set(token.w / 2, token.h / 2);
            
            // Create realistic ethereal mist tendrils
            for (let i = 0; i < 10; i++) {
                const particle = new PIXI.Graphics();
                
                // Create tendril/wisp shapes using curves - much more visible
                const baseAlpha = 0.5 + Math.random() * 0.4; // Increased alpha
                particle.beginFill(0x00FFFF, baseAlpha);
                
                // Draw flowing tendril shape
                const length = 20 + Math.random() * 25;
                const width = 3 + Math.random() * 4;
                
                particle.moveTo(0, 0);
                particle.bezierCurveTo(
                    width * 0.5, length * 0.3,
                    -width * 0.3, length * 0.6,
                    width * 0.2, length
                );
                particle.bezierCurveTo(
                    width * 0.8, length * 0.8,
                    width * 1.2, length * 0.4,
                    width, 0
                );
                particle.closePath();
                particle.endFill();
                
                // Medium blur for ethereal effect but still visible
                const blur = new PIXI.filters.BlurFilter(2 + Math.random() * 2);
                particle.filters = [blur];
                
                // Position around token center (relative to container center)
                const angle = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
                const radius = 15 + Math.random() * 20; // Fixed radius in pixels
                const startX = Math.cos(angle) * radius;
                const startY = Math.sin(angle) * radius;
                
                particle.x = startX;
                particle.y = startY;
                particle.rotation = angle + Math.PI * 0.5; // Point upward
                
                // Store initial values for consistent reset
                const initialAlpha = baseAlpha;
                const initialX = startX;
                const initialY = startY;
                const initialRotation = particle.rotation;
                
                // Wispy floating animation
                const riseSpeed = 0.3 + Math.random() * 0.4;
                const fadeSpeed = 0.003 + Math.random() * 0.002; // Slower fade
                const swayAmount = 2.0 + Math.random() * 1.5;
                const rotateSpeed = 0.015 + Math.random() * 0.01;
                let time = Math.random() * Math.PI * 2;
                let lifeTime = 0;
                const maxLifeTime = 180 + Math.random() * 120; // Fixed lifetime
                
                const animate = () => {
                    time += 0.025;
                    lifeTime++;
                    
                    // Slow rising with complex swaying motion
                    particle.y -= riseSpeed;
                    particle.x = initialX + Math.sin(time) * swayAmount + Math.cos(time * 0.7) * (swayAmount * 0.3);
                    
                    // Gentle rotation
                    particle.rotation = initialRotation + Math.sin(time * 0.5) * rotateSpeed;
                    
                    // Fade based on lifetime for consistent cycling
                    const lifeProgress = lifeTime / maxLifeTime;
                    particle.alpha = initialAlpha * (1 - lifeProgress);
                    
                    // Stretch as it fades
                    particle.scale.y = 1 + lifeProgress * 0.5; // Stretch vertically
                    particle.scale.x = 1 - lifeProgress * 0.3; // Thin horizontally
                    
                    // Reset when lifetime exceeded
                    if (lifeTime >= maxLifeTime) {
                        particle.x = initialX;
                        particle.y = initialY;
                        particle.alpha = initialAlpha;
                        particle.scale.set(1);
                        particle.rotation = initialRotation;
                        time = Math.random() * Math.PI * 2;
                        lifeTime = 0;
                    }
                    
                    requestAnimationFrame(animate);
                };
                
                particleContainer.addChild(particle);
                animate();
            }
            
            // Add smaller ambient wisps
            for (let i = 0; i < 20; i++) {
                const wisp = new PIXI.Graphics();
                
                // More visible wisps
                const baseAlpha = 0.3 + Math.random() * 0.3; // Increased visibility
                wisp.beginFill(0x88FFFF, baseAlpha);
                
                // Draw small elongated shape
                const length = 4 + Math.random() * 8;
                const width = 1 + Math.random() * 2;
                
                wisp.drawEllipse(0, 0, width, length);
                wisp.endFill();
                
                // Light blur for ethereal effect
                const blur = new PIXI.filters.BlurFilter(1 + Math.random() * 1.5);
                wisp.filters = [blur];
                
                // Position around center (relative to particle container)
                const angle = Math.random() * Math.PI * 2;
                const radius = 5 + Math.random() * 40; // Fixed pixel radius
                const startX = Math.cos(angle) * radius;
                const startY = Math.sin(angle) * radius;
                
                wisp.x = startX;
                wisp.y = startY;
                wisp.rotation = Math.random() * Math.PI * 2;
                
                // Store initial values
                const initialAlpha = baseAlpha;
                const initialX = startX;
                const initialY = startY;
                const initialRotation = wisp.rotation;
                
                // Slow, subtle movement with consistent cycling
                const driftSpeed = 0.1 + Math.random() * 0.15;
                let time = Math.random() * Math.PI * 2;
                let lifeTime = 0;
                const maxLifeTime = 300 + Math.random() * 200; // Longer lifetime for ambient effect
                
                const animate = () => {
                    time += 0.015;
                    lifeTime++;
                    
                    // Subtle drifting motion
                    wisp.x = initialX + Math.sin(time) * 3 + Math.cos(time * 0.6) * 2;
                    wisp.y = initialY + Math.cos(time * 0.8) * 2 - (driftSpeed * lifeTime * 0.01);
                    
                    // Gentle rotation
                    wisp.rotation = initialRotation + time * 0.01;
                    
                    // Fade based on lifetime
                    const lifeProgress = lifeTime / maxLifeTime;
                    wisp.alpha = initialAlpha * (1 - lifeProgress * 0.7); // Fade more gradually
                    
                    // Reset when lifetime exceeded
                    if (lifeTime >= maxLifeTime) {
                        wisp.x = initialX;
                        wisp.y = initialY;
                        wisp.alpha = initialAlpha;
                        wisp.rotation = initialRotation;
                        time = Math.random() * Math.PI * 2;
                        lifeTime = 0;
                    }
                    
                    requestAnimationFrame(animate);
                };
                
                particleContainer.addChild(wisp);
                animate();
            }
            
            console.log('fa-token-browser | Spirit particles added to:', token.name);
            
        } catch (error) {
            console.error('fa-token-browser | Error adding spirit particles:', error);
        }
    });
};

/**
 * Apply full spirit effect (transparency + blue tint + particles)
 * Usage: makeSpirit()
 */
window.makeSpirit = function() {
    applySpiritEffect();
    setTimeout(() => addSpiritParticles(), 100);
};

/**
 * Remove all spirit effects and particles
 * Usage: removeSpirit()
 */
window.removeSpirit = function() {
    const controlled = canvas.tokens.controlled;
    
    controlled.forEach(token => {
        // Remove visual effects
        removeSpiritEffect();
        
        // Remove particle container
        const particleContainer = token.getChildByName('spiritParticles');
        if (particleContainer) {
            token.removeChild(particleContainer);
        }
    });
};

/**
 * Fix alpha persistence issues by hooking into token refresh
 * Usage: fixSpiritAlpha()
 */
window.fixSpiritAlpha = function() {
    const tokens = canvas.tokens.placeables;
    tokens.forEach(token => {
        const isSpirit = token.document.getFlag('fa-token-browser', 'isSpirit');
        const spiritAlpha = token.document.getFlag('fa-token-browser', 'spiritAlpha');
        
        if (isSpirit && spiritAlpha && token.mesh) {
            token.mesh.alpha = spiritAlpha;
            console.log('fa-token-browser | Fixed alpha for spirit token:', token.name);
        }
    });
};

/**
 * Make spirit effects permanent by hooking into Foundry's token system
 * Usage: makeSpiritEffectsPermanent()
 */
window.makeSpiritEffectsPermanent = function() {
    // Hook into token refresh events
    if (window._spiritEffectHook) {
        Hooks.off('refreshToken', window._spiritEffectHook);
    }
    
    window._spiritEffectHook = Hooks.on('refreshToken', (token) => {
        const isSpirit = token.document.getFlag('fa-token-browser', 'isSpirit');
        if (!isSpirit) return;
        
        // Reapply spirit effects after any token refresh
        setTimeout(() => {
            try {
                const spiritAlpha = token.document.getFlag('fa-token-browser', 'spiritAlpha');
                const spiritFilters = token.document.getFlag('fa-token-browser', 'spiritFilters');
                
                if (token.mesh) {
                    // Restore alpha
                    if (spiritAlpha) {
                        token.mesh.alpha = spiritAlpha;
                    }
                    
                    // Restore filters
                    if (spiritFilters) {
                        const filters = [];
                        
                        // Recreate color matrix filter
                        if (spiritFilters.colorMatrix) {
                            const colorMatrix = new PIXI.filters.ColorMatrixFilter();
                            colorMatrix.matrix = spiritFilters.colorMatrix;
                            filters.push(colorMatrix);
                        }
                        
                        // Recreate custom glow filter
                        if (spiritFilters.customGlow) {
                            const glowFilter = new CustomGlowFilter(spiritFilters.customGlow);
                            filters.push(glowFilter);
                        }
                        
                        token.mesh.filters = filters;
                    }
                }
                
                console.log('fa-token-browser | Auto-restored spirit effects for:', token.name);
            } catch (error) {
                console.error('fa-token-browser | Error auto-restoring spirit effects:', error);
            }
        }, 100);
    });
    
    console.log('fa-token-browser | Spirit effects will now persist automatically!');
};

/**
 * Enhanced spirit effect application that saves settings for persistence
 * Usage: applySpiritEffectPermanent()
 */
window.applySpiritEffectPermanent = function() {
    const controlled = canvas.tokens.controlled;
    
    if (controlled.length === 0) {
        console.warn('fa-token-browser | No tokens selected. Please select a token first.');
        return;
    }
    
    controlled.forEach(token => {
        try {
            console.log('fa-token-browser | Applying permanent spirit effect to token:', token.name);
            
            const sprite = token.mesh;
            if (!sprite) {
                console.error('fa-token-browser | No sprite found for token:', token.name);
                return;
            }
            
            // Apply spirit transparency
            sprite.alpha = 0.75;
            
            // Create filter stack
            const filters = [];
            const filterData = {};
            
            // Color Matrix Filter
            const ColorMatrixFilter = PIXI.ColorMatrixFilter || PIXI.filters?.ColorMatrixFilter;
            if (ColorMatrixFilter) {
                const colorMatrix = new ColorMatrixFilter();
                const matrix = [
                    0.1, 0.1, 0.1, 0.0, 0.0,   // Red channel (minimal)
                    0.3, 0.3, 0.3, 0.0, 0.1,   // Green channel (more for cyan/turquoise)
                    0.4, 0.4, 0.8, 0.0, 0.3,   // Blue channel (strong but not overwhelming)
                    0.0, 0.0, 0.0, 1.0, 0.0    // Alpha channel
                ];
                colorMatrix.matrix = matrix;
                filters.push(colorMatrix);
                filterData.colorMatrix = matrix;
            }
            
            // Custom Glow Filter
            const glowOptions = {
                strength: 1.5,
                color: [0.0, 0.8, 1.0],
                size: 8.0
            };
            const glowFilter = new CustomGlowFilter(glowOptions);
            filters.push(glowFilter);
            filterData.customGlow = glowOptions;
            
            sprite.filters = filters;
            
            // Save all settings to token flags for persistence
            token.document.setFlag('fa-token-browser', 'isSpirit', true);
            token.document.setFlag('fa-token-browser', 'spiritAlpha', 0.75);
            token.document.setFlag('fa-token-browser', 'spiritFilters', filterData);
            
            console.log('fa-token-browser | Permanent spirit effect applied to:', token.name);
            
        } catch (error) {
            console.error('fa-token-browser | Error applying permanent spirit effect:', error);
        }
    });
};

/**
 * Custom Glow Filter using PIXI shader
 */
class CustomGlowFilter extends PIXI.Filter {
    constructor(options = {}) {
        const vertex = `
            attribute vec2 aVertexPosition;
            attribute vec2 aTextureCoord;
            
            uniform mat3 projectionMatrix;
            
            varying vec2 vTextureCoord;
            
            void main(void) {
                gl_Position = vec4((projectionMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
                vTextureCoord = aTextureCoord;
            }
        `;
        
        const fragment = `
            varying vec2 vTextureCoord;
            uniform sampler2D uSampler;
            uniform float glowStrength;
            uniform vec3 glowColor;
            uniform float glowSize;
            
            void main(void) {
                vec4 pixel = texture2D(uSampler, vTextureCoord);
                
                // Sample surrounding pixels for glow (fixed loop bounds)
                vec4 glow = vec4(0.0);
                float total = 0.0;
                
                // Fixed sample pattern instead of dynamic loop
                vec2 offsets[9];
                offsets[0] = vec2(-1.0, -1.0);
                offsets[1] = vec2(0.0, -1.0);
                offsets[2] = vec2(1.0, -1.0);
                offsets[3] = vec2(-1.0, 0.0);
                offsets[4] = vec2(0.0, 0.0);
                offsets[5] = vec2(1.0, 0.0);
                offsets[6] = vec2(-1.0, 1.0);
                offsets[7] = vec2(0.0, 1.0);
                offsets[8] = vec2(1.0, 1.0);
                
                for(int i = 0; i < 9; i++) {
                    vec2 offset = offsets[i] * glowSize / 512.0;
                    float distance = length(offsets[i]);
                    float weight = 1.0 - (distance / 2.0);
                    vec4 sample = texture2D(uSampler, vTextureCoord + offset);
                    glow += sample * weight;
                    total += weight;
                }
                
                if(total > 0.0) {
                    glow /= total;
                }
                
                // Apply glow color
                vec3 glowEffect = glow.rgb * glowColor * glowStrength * glow.a;
                
                // Combine original pixel with glow
                vec3 result = pixel.rgb + glowEffect;
                gl_FragColor = vec4(result, pixel.a);
            }
        `;
        
        super(vertex, fragment, {
            glowStrength: options.strength || 1.0,
            glowColor: options.color || [0.0, 1.0, 1.0], // Cyan
            glowSize: options.size || 5.0
        });
        
        this.glowStrength = options.strength || 1.0;
        this.glowColor = options.color || [0.0, 1.0, 1.0];
        this.glowSize = options.size || 5.0;
    }
    
    get strength() { return this.uniforms.glowStrength; }
    set strength(value) { this.uniforms.glowStrength = value; }
    
    get color() { return this.uniforms.glowColor; }
    set color(value) { this.uniforms.glowColor = value; }
    
    get size() { return this.uniforms.glowSize; }
    set size(value) { this.uniforms.glowSize = value; }
}

/**
 * Apply custom glow effect using our shader
 * Usage: customGlow()
 */
window.customGlow = function() {
    const controlled = canvas.tokens.controlled;
    
    if (controlled.length === 0) {
        console.warn('fa-token-browser | No tokens selected. Please select a token first.');
        return;
    }
    
    controlled.forEach(token => {
        try {
            const sprite = token.mesh;
            if (!sprite) return;
            
            // Create custom glow filter
            const glowFilter = new CustomGlowFilter({
                strength: 1.5,
                color: [0.0, 0.8, 1.0], // Cyan/turquoise
                size: 8.0
            });
            
            // Add to existing filters or create new array
            const filters = sprite.filters || [];
            filters.push(glowFilter);
            sprite.filters = filters;
            
            // Store reference for cleanup
            sprite._customGlow = glowFilter;
            
            console.log('fa-token-browser | Custom glow shader applied to:', token.name);
            
        } catch (error) {
            console.error('fa-token-browser | Error applying custom glow:', error);
        }
    });
};

/**
 * Simple glow using only available blur filters
 * Usage: simpleGlow()
 */
window.simpleGlow = function() {
    const controlled = canvas.tokens.controlled;
    
    if (controlled.length === 0) {
        console.warn('fa-token-browser | No tokens selected. Please select a token first.');
        return;
    }
    
    controlled.forEach(token => {
        try {
            const sprite = token.mesh;
            if (!sprite) return;
            
            // Create glow by manipulating the sprite itself
            sprite.tint = 0x88FFFF; // Apply cyan tint
            
            // Add blur for glow effect
            const blurFilter = new PIXI.filters.BlurFilter(3);
            const filters = sprite.filters || [];
            filters.push(blurFilter);
            sprite.filters = filters;
            
            // Store reference
            sprite._simpleGlow = blurFilter;
            console.log('fa-token-browser | Simple glow applied to:', token.name);
            
        } catch (error) {
            console.error('fa-token-browser | Error applying simple glow:', error);
        }
    });
};

/**
 * Canvas-based glow using Graphics objects
 * Usage: graphicsGlow()
 */
window.graphicsGlow = function() {
    const controlled = canvas.tokens.controlled;
    
    if (controlled.length === 0) {
        console.warn('fa-token-browser | No tokens selected. Please select a token first.');
        return;
    }
    
    controlled.forEach(token => {
        try {
            const sprite = token.mesh;
            if (!sprite) return;
            
            // Create a graphics-based glow
            const glowGraphics = new PIXI.Graphics();
            
            // Draw multiple circles for glow layers
            for (let i = 0; i < 5; i++) {
                const radius = 20 + (i * 8);
                const alpha = 0.15 - (i * 0.02);
                
                glowGraphics.beginFill(0x00FFFF, alpha);
                glowGraphics.drawCircle(0, 0, radius);
                glowGraphics.endFill();
            }
            
            // Position at sprite center
            glowGraphics.position.set(sprite.width / 2, sprite.height / 2);
            
            // Add blur to the graphics
            const blurFilter = new PIXI.filters.BlurFilter(8);
            glowGraphics.filters = [blurFilter];
            
            // Add to sprite's parent
            if (sprite.parent) {
                const spriteIndex = sprite.parent.getChildIndex(sprite);
                sprite.parent.addChildAt(glowGraphics, spriteIndex);
                
                sprite._graphicsGlow = glowGraphics;
                console.log('fa-token-browser | Graphics glow applied to:', token.name);
            }
            
        } catch (error) {
            console.error('fa-token-browser | Error applying graphics glow:', error);
        }
    });
};

// Log available commands
console.log('fa-token-browser | Spirit effect console commands loaded:');
console.log('  applySpiritEffect() - Apply transparency and blue tint');
console.log('  applySpiritEffectPermanent() - Apply spirit effect that persists');
console.log('  removeSpiritEffect() - Remove visual effects');
console.log('  addSpiritParticles() - Add ethereal mist/fire particles');
console.log('  makeSpirit() - Apply full spirit effect');
console.log('  removeSpirit() - Remove all spirit effects');
console.log('  fixSpiritAlpha() - Fix alpha persistence issues');
console.log('  makeSpiritEffectsPermanent() - Hook to make effects auto-restore');
console.log('  customGlow() - Apply custom shader glow effect');
console.log('  simpleGlow() - Apply simple blur-based glow');
console.log('  graphicsGlow() - Apply graphics-based glow circles');
console.log('  Select a token first, then run any command!');