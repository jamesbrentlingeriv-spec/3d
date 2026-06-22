// Main Engine Coordinator for 3D Eyewear Try-On Studio (Babylon.js)

document.addEventListener('DOMContentLoaded', () => {
  // ─── Theme Toggle (light mode default, persisted to localStorage) ───
  (function initTheme() {
    const html = document.documentElement;
    const toggle = document.getElementById('themeToggle');
    const saved = localStorage.getItem('eyewear-theme');
    // Default to light; use saved preference if it exists
    if (saved === 'dark') {
      html.setAttribute('data-theme', 'dark');
    } else {
      html.removeAttribute('data-theme');
    }
    if (toggle) {
      toggle.addEventListener('click', () => {
        if (html.getAttribute('data-theme') === 'dark') {
          html.removeAttribute('data-theme');
          localStorage.setItem('eyewear-theme', 'light');
        } else {
          html.setAttribute('data-theme', 'dark');
          localStorage.setItem('eyewear-theme', 'dark');
        }
      });
    }
  })();

  // Share state globally through EyewearStudio namespace
  window.EyewearStudio = window.EyewearStudio || {};
  const studio = window.EyewearStudio;

  // Server API for cross-device placement sync
  let API_BASE = '';  // Same-origin when served by the Express server
  if (window.location.port && window.location.port !== '3000') {
    // If client is loaded on a dev port (e.g. 8080), route API calls to the Express server on port 3000
    API_BASE = `${window.location.protocol}//${window.location.hostname}:3000`;
  }
  const PLACEMENTS_ENDPOINT = `${API_BASE}/api/placements`;

  const canvas = document.getElementById('renderCanvas');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = document.getElementById('loadingText');
  const progressBar = document.getElementById('progressBar');

  // Active scene objects
  let engine = null;
  let scene = null;
  let camera = null;
  let currentLights = [];
  let shadowGenerator = null;

  // Transform Groups
  let headGroup = null;
  let eyewearGroup = null;

  let activeAttributionHTML = '"Callie" head model uploaded by user.';

  // Material settings state
  const frameColorPicker = document.getElementById('frameColor');
  const metalnessSlider = document.getElementById('frameMetalness');
  const roughnessSlider = document.getElementById('frameRoughness');
  const opacitySlider = document.getElementById('frameOpacity');
  const headYawSlider = document.getElementById('headYaw');
  const valHeadYawBadge = document.getElementById('valHeadYaw');
  const overrideCheckbox = document.getElementById('overrideMaterials');

  // Sliders and badges
  const sliders = {
    posX: { input: document.getElementById('posX'), badge: document.getElementById('valPosX'), key: 'position', axis: 'x' },
    posY: { input: document.getElementById('posY'), badge: document.getElementById('valPosY'), key: 'position', axis: 'y' },
    posZ: { input: document.getElementById('posZ'), badge: document.getElementById('valPosZ'), key: 'position', axis: 'z' },
    rotX: { input: document.getElementById('rotX'), badge: document.getElementById('valRotX'), key: 'rotation', axis: 'x', isAngle: true },
    rotY: { input: document.getElementById('rotY'), badge: document.getElementById('valRotY'), key: 'rotation', axis: 'y', isAngle: true },
    rotZ: { input: document.getElementById('rotZ'), badge: document.getElementById('valRotZ'), key: 'rotation', axis: 'z', isAngle: true },
    scale: { input: document.getElementById('scale'), badge: document.getElementById('valScale'), key: 'scale', axis: 'all' },
    scaleX: { input: document.getElementById('scaleX'), badge: document.getElementById('valScaleX'), key: 'scale', axis: 'x' },
    scaleY: { input: document.getElementById('scaleY'), badge: document.getElementById('valScaleY'), key: 'scale', axis: 'y' },
    scaleZ: { input: document.getElementById('scaleZ'), badge: document.getElementById('valScaleZ'), key: 'scale', axis: 'z' }
  };

  // UI elements
  const toggleWireframeBtn = document.getElementById('toggleWireframe');
  const resetCameraBtn = document.getElementById('resetCamera');
  const resetTransformBtn = document.getElementById('resetTransform');
  const autoRotateCheckbox = document.getElementById('autoRotate');
  const studioBtns = document.querySelectorAll('.studio-btn');

  let wireframeEnabled = false;

  // Initialize Babylon.js Engine
  const initEngine = () => {
    engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, alpha: true });
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.04, 0.05, 0.07, 1); // Dark blue-grey

    // Create ArcRotateCamera
    camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.1, 2.1, new BABYLON.Vector3(0, 0.35, 0), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 0.6;
    camera.upperRadiusLimit = 6;
    camera.wheelPrecision = 45;
    camera.panningSensibility = 1000;
    
    // Add transform nodes
    headGroup = new BABYLON.TransformNode("headGroup", scene);
    eyewearGroup = new BABYLON.TransformNode("eyewearGroup", scene);
    
    // Set default transform group parameters
    resetSliders();

    // Default lighting setup
    setLightingProfile("studio");

    // Start engine loop
    engine.runRenderLoop(() => {
      scene.render();
      if (autoRotateCheckbox.checked && camera) {
        camera.alpha += 0.003;
      }
    });

    window.addEventListener('resize', () => {
      engine.resize();
    });

    studio.scene = scene;
    setupDragInteraction();
  };

  // Set up 3D click-and-drag interaction for eyewear
  const setupDragInteraction = () => {
    let isDraggingEyewear = false;
    let dragStartPoint = null;
    let eyewearStartPos = null;
    let dragPlane = null;

    scene.onPointerObservable.add((pointerInfo) => {
      switch (pointerInfo.type) {
        case BABYLON.PointerEventTypes.POINTERDOWN:
          if (pointerInfo.pickInfo.hit && studio.eyewearMesh) {
            // Check if user clicked the eyewear or any of its child meshes
            let node = pointerInfo.pickInfo.pickedMesh;
            let isEyewearChild = false;
            while (node) {
              if (node === studio.eyewearMesh || node === eyewearGroup) {
                isEyewearChild = true;
                break;
              }
              node = node.parent;
            }

            if (isEyewearChild) {
              isDraggingEyewear = true;
              camera.detachControl(canvas); // Disable camera orbit rotation
              
              // Create a drag plane oriented towards the camera at the intersection point
              dragPlane = BABYLON.MeshBuilder.CreatePlane("dragPlane", { size: 100 }, scene);
              dragPlane.position = pointerInfo.pickInfo.pickedPoint;
              dragPlane.lookAt(camera.position);
              dragPlane.visibility = 0; // Invisible plane
              
              // Raycast cursor onto dragPlane to get reference start point
              const pickResult = scene.pick(scene.pointerX, scene.pointerY, (m) => m === dragPlane);
              if (pickResult.hit) {
                dragStartPoint = pickResult.pickedPoint;
                eyewearStartPos = studio.eyewearMesh.position.clone();
              }
            }
          }
          break;

        case BABYLON.PointerEventTypes.POINTERMOVE:
          if (isDraggingEyewear && dragPlane && studio.eyewearMesh) {
            // Get current point on drag plane
            const pickResult = scene.pick(scene.pointerX, scene.pointerY, (m) => m === dragPlane);
            if (pickResult.hit) {
              const currentPoint = pickResult.pickedPoint;
              const diff = currentPoint.subtract(dragStartPoint);
              
              // Update eyewear position
              const newPos = eyewearStartPos.add(diff);
              studio.eyewearMesh.position.copyFrom(newPos);
              
              // Sync UI sliders and badges
              sliders.posX.input.value = newPos.x.toFixed(3);
              sliders.posY.input.value = newPos.y.toFixed(3);
              sliders.posZ.input.value = newPos.z.toFixed(3);
              
              sliders.posX.badge.textContent = newPos.x.toFixed(2);
              sliders.posY.badge.textContent = newPos.y.toFixed(2);
              sliders.posZ.badge.textContent = newPos.z.toFixed(2);
            }
          }
          break;

        case BABYLON.PointerEventTypes.POINTERUP:
          if (isDraggingEyewear) {
            isDraggingEyewear = false;
            camera.attachControl(canvas, true); // Re-enable camera orbit
            if (dragPlane) {
              dragPlane.dispose();
              dragPlane = null;
            }
            dragStartPoint = null;
            eyewearStartPos = null;
          }
          break;
      }
    });
  };

  // Loading Overlay Control
  const showLoading = (text, progress = null) => {
    loadingOverlay.classList.remove('fade-out');
    loadingText.textContent = text;
    if (progress !== null) {
      progressBar.style.width = `${progress}%`;
    } else {
      progressBar.style.width = '100%';
    }
  };

  const hideLoading = () => {
    progressBar.style.width = '100%';
    setTimeout(() => {
      loadingOverlay.classList.add('fade-out');
    }, 400);
  };

  // Lighting Configurations
  const setLightingProfile = (profile) => {
    // Clean up current lights
    currentLights.forEach(light => light.dispose());
    currentLights = [];
    shadowGenerator = null;

    if (profile === "studio") {
      // Warm key light
      const keyLight = new BABYLON.DirectionalLight("keyLight", new BABYLON.Vector3(-0.5, -0.5, 1), scene);
      keyLight.position = new BABYLON.Vector3(2, 4, -4);
      keyLight.intensity = 1.8;
      keyLight.diffuse = new BABYLON.Color3(1, 0.96, 0.9);
      currentLights.push(keyLight);

      // Cool fill light
      const fillLight = new BABYLON.DirectionalLight("fillLight", new BABYLON.Vector3(0.6, -0.3, 0.8), scene);
      fillLight.position = new BABYLON.Vector3(-3, 3, -3);
      fillLight.intensity = 1.0;
      fillLight.diffuse = new BABYLON.Color3(0.9, 0.95, 1);
      currentLights.push(fillLight);

      // Ambient hemispheric light
      const hemiLight = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), scene);
      hemiLight.intensity = 0.5;
      hemiLight.groundColor = new BABYLON.Color3(0.1, 0.12, 0.15);
      hemiLight.diffuse = new BABYLON.Color3(0.2, 0.22, 0.25);
      currentLights.push(hemiLight);

      // High quality Rim light (backlight for silhouette halo)
      const rimLight = new BABYLON.DirectionalLight("rimLight", new BABYLON.Vector3(0, -0.5, -1), scene);
      rimLight.position = new BABYLON.Vector3(0, 3, 4);
      rimLight.intensity = 2.2;
      rimLight.diffuse = new BABYLON.Color3(0.95, 0.97, 1);
      currentLights.push(rimLight);

      // Shadow Generator using key light
      shadowGenerator = new BABYLON.ShadowGenerator(1024, keyLight);
      shadowGenerator.useBlurExponentialShadowMap = true;
      shadowGenerator.blurKernel = 32;
      shadowGenerator.darkness = 0.45;
    }
    else if (profile === "cyber") {
      // Hot magenta key
      const pinkLight = new BABYLON.PointLight("pinkLight", new BABYLON.Vector3(2.5, 0.5, -2), scene);
      pinkLight.intensity = 3.5;
      pinkLight.diffuse = new BABYLON.Color3(1, 0.05, 0.6);
      pinkLight.specular = new BABYLON.Color3(1, 0.05, 0.6);
      currentLights.push(pinkLight);

      // Electric cyan fill
      const cyanLight = new BABYLON.PointLight("cyanLight", new BABYLON.Vector3(-2.5, 0.8, -1.8), scene);
      cyanLight.intensity = 4.0;
      cyanLight.diffuse = new BABYLON.Color3(0, 0.9, 1);
      cyanLight.specular = new BABYLON.Color3(0, 0.9, 1);
      currentLights.push(cyanLight);

      // Subdued ambient
      const hemiLight = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), scene);
      hemiLight.intensity = 0.25;
      hemiLight.diffuse = new BABYLON.Color3(0.1, 0.05, 0.25);
      currentLights.push(hemiLight);

      // Cyberpunk backlight
      const backLight = new BABYLON.DirectionalLight("backLight", new BABYLON.Vector3(0, -0.2, -1), scene);
      backLight.position = new BABYLON.Vector3(0, 2, 3);
      backLight.intensity = 3.0;
      backLight.diffuse = new BABYLON.Color3(0.5, 0, 1); // Deep violet
      currentLights.push(backLight);
    }
    else if (profile === "sunset") {
      // Low angle warm golden light
      const sunLight = new BABYLON.DirectionalLight("sunLight", new BABYLON.Vector3(-0.8, -0.2, 0.8), scene);
      sunLight.position = new BABYLON.Vector3(4, 1.5, -4);
      sunLight.intensity = 2.8;
      sunLight.diffuse = new BABYLON.Color3(1, 0.6, 0.2); // Warm orange
      sunLight.specular = new BABYLON.Color3(1, 0.75, 0.4);
      currentLights.push(sunLight);

      // Cool blue ambient fill
      const fillLight = new BABYLON.DirectionalLight("fillLight", new BABYLON.Vector3(0.8, -0.4, 0.6), scene);
      fillLight.position = new BABYLON.Vector3(-4, 2, -3);
      fillLight.intensity = 0.8;
      fillLight.diffuse = new BABYLON.Color3(0.2, 0.4, 0.85); // Blue
      currentLights.push(fillLight);

      // Sky glow hemispheric
      const hemiLight = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), scene);
      hemiLight.intensity = 0.4;
      hemiLight.diffuse = new BABYLON.Color3(0.35, 0.2, 0.4); // Purplish sky
      currentLights.push(hemiLight);

      // Shadow setup
      shadowGenerator = new BABYLON.ShadowGenerator(1024, sunLight);
      shadowGenerator.useBlurExponentialShadowMap = true;
      shadowGenerator.blurKernel = 40;
      shadowGenerator.darkness = 0.55;
    }
    else if (profile === "noir") {
      // Stark white spotlight
      const spotLight = new BABYLON.SpotLight("spotLight", new BABYLON.Vector3(0, 3, -2.5), new BABYLON.Vector3(0, -0.85, 0.8), Math.PI / 3.5, 2, scene);
      spotLight.intensity = 5.0;
      spotLight.diffuse = new BABYLON.Color3(1, 1, 1);
      spotLight.specular = new BABYLON.Color3(1, 1, 1);
      currentLights.push(spotLight);

      // Barely visible ambient
      const hemiLight = new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), scene);
      hemiLight.intensity = 0.08;
      hemiLight.diffuse = new BABYLON.Color3(0.5, 0.5, 0.5);
      currentLights.push(hemiLight);

      // Strong shadows
      shadowGenerator = new BABYLON.ShadowGenerator(1024, spotLight);
      shadowGenerator.useContactHardeningShadow = true;
      shadowGenerator.contactHardeningLightSizeUvratios = 0.05;
      shadowGenerator.darkness = 0.85;
    }

    // Refresh shadow receiver configurations
    rebindShadows();
  };

  // Re-apply shadow casting and receiving flags across meshes
  const rebindShadows = () => {
    if (!shadowGenerator) return;

    // Head meshes receive shadows
    headGroup.getChildMeshes().forEach(mesh => {
      mesh.receiveShadows = true;
    });

    // Eyewear meshes cast shadows
    eyewearGroup.getChildMeshes().forEach(mesh => {
      shadowGenerator.addShadowCaster(mesh, true);
    });
  };

  // Material optimizer to prevent see-through / hollow rendering on head scans
  const optimizeHeadMaterial = (material) => {
    if (!material) return;
    if (material instanceof BABYLON.MultiMaterial) {
      material.subMaterials.forEach(sub => optimizeHeadMaterial(sub));
    } else {
      material.backFaceCulling = true; // Prevents interior rendering and see-through issues
      material.alpha = 1.0;
      if (material instanceof BABYLON.PBRMaterial) {
        material.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_OPAQUE; // Force opaque
        if (material.albedoTexture) {
          material.albedoTexture.hasAlpha = false;
        }
        material.roughness = 0.65;
        material.metallic = 0.05;
      } else if (material instanceof BABYLON.StandardMaterial) {
        if (material.diffuseTexture) {
          material.diffuseTexture.hasAlpha = false;
        }
        if (material.opacityTexture) {
          material.opacityTexture = null;
        }
      }
    }
  };

  const getActiveHeadKey = () => {
    if (studio.loadHeadModelKey === 'custom') {
      return `custom_head_${studio.activeCustomHeadName || 'mesh'}`;
    }
    return studio.loadHeadModelKey || 'unknown';
  };

  const getActiveEyewearKey = () => {
    if (studio.activeCatalogItemId) {
      return `catalog_${studio.activeCatalogItemId}`;
    } else if (studio.eyewearType) {
      return `custom_${studio.eyewearType}_${studio.activeCustomFileName || 'eyewear'}`;
    }
    return null;
  };

  // Apply saved config values to UI sliders
  const applyConfigToSliders = (saved) => {
    sliders.posX.input.value = saved.posX;
    sliders.posY.input.value = saved.posY;
    sliders.posZ.input.value = saved.posZ;
    sliders.rotX.input.value = saved.rotX;
    sliders.rotY.input.value = saved.rotY;
    sliders.rotZ.input.value = saved.rotZ;
    sliders.scale.input.value = saved.scale;
    sliders.scaleX.input.value = saved.scaleX;
    sliders.scaleY.input.value = saved.scaleY;
    sliders.scaleZ.input.value = saved.scaleZ;
    if (overrideCheckbox && saved.overrideMaterials !== undefined) {
      overrideCheckbox.checked = saved.overrideMaterials;
    } else if (overrideCheckbox) {
      overrideCheckbox.checked = false;
    }
  };

  // Save placement to server API (cross-device sync)
  const savePlacementToServer = async (storageKey, config) => {
    try {
      const response = await fetch(PLACEMENTS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: storageKey, config })
      });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      return true;
    } catch (err) {
      console.warn('Server save failed, using localStorage only:', err.message);
      return false;
    }
  };

  // Fetch a single placement from server
  const fetchPlacementFromServer = async (storageKey) => {
    try {
      const response = await fetch(`${PLACEMENTS_ENDPOINT}/${encodeURIComponent(storageKey)}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      console.warn('Server fetch failed:', err.message);
      return null;
    }
  };

  // Sync placements bidirectionally on startup (downloads server data and uploads any local-only data)
  const syncPlacementsFromServer = async () => {
    try {
      const response = await fetch(PLACEMENTS_ENDPOINT);
      if (!response.ok) return;
      const serverData = await response.json();
      
      // 1. Download server placements to localStorage
      for (const [key, config] of Object.entries(serverData)) {
        localStorage.setItem(key, JSON.stringify(config));
      }
      
      // 2. Find local-only placements and upload them to the server
      let uploadedCount = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('eyewear_fit_')) {
          if (!serverData[key]) {
            const localConfigStr = localStorage.getItem(key);
            try {
              const config = JSON.parse(localConfigStr);
              await savePlacementToServer(key, config);
              uploadedCount++;
            } catch (e) {
              console.error("Failed to sync local placement to server:", e);
            }
          }
        }
      }
      
      console.log(`Synced: downloaded ${Object.keys(serverData).length} from server, uploaded ${uploadedCount} local placements`);
    } catch (err) {
      console.warn('Server sync unavailable, using localStorage:', err.message);
    }
  };

  // Helper to load and apply saved placement transforms for a specific eyewear-head pair
  // Tries server API first, falls back to localStorage
  const applySavedPlacement = (eyewearKey, headKey) => {
    const storageKey = `eyewear_fit_${eyewearKey}_on_${headKey}`;

    // Try localStorage first (fast, works offline)
    const savedConfigStr = localStorage.getItem(storageKey);
    if (savedConfigStr) {
      try {
        const saved = JSON.parse(savedConfigStr);
        applyConfigToSliders(saved);
        return true;
      } catch (e) {
        console.error("Failed to parse saved config:", e);
      }
    }

    // Async: also fetch from server and refresh localStorage in background
    fetchPlacementFromServer(storageKey).then(serverConfig => {
      if (serverConfig) {
        localStorage.setItem(storageKey, JSON.stringify(serverConfig));
        applyConfigToSliders(serverConfig);
      }
    }).catch(() => {});

    if (overrideCheckbox) {
      overrideCheckbox.checked = false;
    }
    return false;
  };

  studio.loadHeadModelKey = 'callie'; // Tracks active head

  // Default Head Scan Loader
  const loadDefaultHead = async (modelKey = studio.loadHeadModelKey) => {
    showLoading("Loading 3D Face Scan...", 10);
    
    // Dispose of previous head models
    if (studio.defaultHead) studio.defaultHead.dispose();
    if (studio.customHead) studio.customHead.dispose();
    studio.defaultHead = null;
    studio.customHead = null;

    studio.loadHeadModelKey = modelKey;
    
    let filename = "";
    let attributionHTML = "";
    let headNameLabel = "";

    if (modelKey === 'callie') {
      filename = "Callie.glb";
      attributionHTML = `"Callie" head model uploaded by user.`;
      headNameLabel = "Callie (Female)";
    } else if (modelKey === 'chris') {
      filename = "Chris.glb";
      attributionHTML = `"Chris" head model uploaded by user.`;
      headNameLabel = "Chris (Male)";
    } else if (modelKey === 'kanaya') {
      filename = "Kanaya.glb";
      attributionHTML = `"Kanaya" head model uploaded by user.`;
      headNameLabel = "Kanaya (Female)";
    } else if (modelKey === 'byron') {
      filename = "Byron.glb";
      attributionHTML = `"Byron" head model uploaded by user.`;
      headNameLabel = "Byron (Male)";
    } else if (modelKey === 'maria') {
      filename = "Maria.glb";
      attributionHTML = `"Maria" head model uploaded by user.`;
      headNameLabel = "Maria (Female)";
    } else if (modelKey === 'darius') {
      filename = "Darius.glb";
      attributionHTML = `"Darius" head model uploaded by user.`;
      headNameLabel = "Darius (Male)";
    } else if (modelKey === 'mannequin') {
      loadMannequinHead();
      document.getElementById('activeHeadName').textContent = "Mannequin (Stylized)";
      document.getElementById('attributionText').innerHTML = "Stylized ceramic mannequin head built procedurally.";
      
      // Apply saved eyewear placement specifically for mannequin
      if (studio.eyewearMesh) {
        const eyewearKey = getActiveEyewearKey();
        if (eyewearKey) {
          applySavedPlacement(eyewearKey, 'mannequin');
          updateTransformFromSliders();
          applyMaterialOverrides();
        }
      }
      return;
    }

    const rootUrl = "./";

    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync(
        "", 
        rootUrl, 
        filename, 
        scene,
        (evt) => {
          if (evt.lengthComputable) {
            const pct = Math.floor((evt.loaded * 90) / evt.total) + 10;
            showLoading("Downloading 3D Face Scan...", pct);
          }
        },
        ".glb"
      );

      // Create main head node
      const defaultHead = new BABYLON.TransformNode("defaultHead", scene);
      defaultHead.parent = headGroup;

      result.meshes.forEach(mesh => {
        if (!mesh.parent) {
          mesh.parent = defaultHead;
        }
        
        // Calibrate materials
        if (mesh.material) {
          optimizeHeadMaterial(mesh.material);
        }
      });

      // Temporarily reset headGroup transforms for accurate bounding calculation
      const tempRotation = headGroup.rotation.clone();
      const tempPosition = headGroup.position.clone();
      headGroup.rotation.set(0, 0, 0);
      headGroup.position.set(0, 0, 0);

      // Compute bounding box to normalize scaling and position
      let min = new BABYLON.Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
      let max = new BABYLON.Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

      defaultHead.getChildMeshes().forEach(mesh => {
        if (mesh.getTotalVertices() > 0) {
          mesh.computeWorldMatrix(true);
          const boundingInfo = mesh.getBoundingInfo();
          min = BABYLON.Vector3.Minimize(min, boundingInfo.boundingBox.minimumWorld);
          max = BABYLON.Vector3.Maximize(max, boundingInfo.boundingBox.maximumWorld);
        }
      });

      const center = max.add(min).scale(0.5);
      const size = max.subtract(min);
      const maxDimension = Math.max(size.x, size.y, size.z);

      // Normalize size to exactly 1.3 units height
      const scaleFactor = 1.3 / maxDimension;
      defaultHead.scaling.set(scaleFactor, scaleFactor, scaleFactor);

      // Center it at Y=0.35 Y offset
      defaultHead.position.set(-center.x * scaleFactor, -center.y * scaleFactor + 0.35, -center.z * scaleFactor);

      // Restore headGroup transforms
      headGroup.rotation = tempRotation;
      headGroup.position = tempPosition;

      studio.defaultHead = defaultHead;
      studio.headMesh = defaultHead;

      // Update UI active label and credits
      document.getElementById('activeHeadName').textContent = headNameLabel;
      document.getElementById('attributionText').innerHTML = attributionHTML;
      activeAttributionHTML = attributionHTML;

      // Ensure wireframe matches setting
      toggleWireframeState(wireframeEnabled);
      rebindShadows();

      // Apply saved eyewear placement specifically for this default head model
      if (studio.eyewearMesh) {
        const eyewearKey = getActiveEyewearKey();
        if (eyewearKey) {
          applySavedPlacement(eyewearKey, modelKey);
          updateTransformFromSliders();
          applyMaterialOverrides();
        }
      }

      hideLoading();
    } catch (err) {
      console.error("Failed to load local head scan:", err);
      // Fallback
      loadMannequinHead();
    }
  };

  // Procedural Mannequin Head Fallback
  const loadMannequinHead = () => {
    showLoading("Loading Mannequin Head (Fallback)...", 50);

    if (studio.defaultHead) studio.defaultHead.dispose();
    if (studio.customHead) studio.customHead.dispose();
    studio.defaultHead = null;
    studio.customHead = null;

    const customHead = new BABYLON.TransformNode("mannequinHead", scene);
    customHead.parent = headGroup;

    // Materials
    const skinMat = new BABYLON.PBRMaterial("mannequinSkin", scene);
    skinMat.albedoColor = new BABYLON.Color3(0.9, 0.91, 0.94);
    skinMat.roughness = 0.25;
    skinMat.metallic = 0.1;

    const eyeMat = new BABYLON.PBRMaterial("mannequinEyes", scene);
    eyeMat.albedoColor = new BABYLON.Color3(0.1, 0.11, 0.13);
    eyeMat.roughness = 0.1;
    eyeMat.metallic = 0.9;

    // Skull
    const skull = BABYLON.MeshBuilder.CreateSphere("skull", { diameterX: 0.95, diameterY: 1.25, diameterZ: 1.0, segments: 32 }, scene);
    skull.parent = customHead;
    skull.position.set(0, 0.35, 0);
    skull.material = skinMat;

    // Neck
    const neck = BABYLON.MeshBuilder.CreateCylinder("neck", { height: 0.45, diameter: 0.38 }, scene);
    neck.parent = customHead;
    neck.position.set(0, -0.35, -0.05);
    neck.material = skinMat;

    // Nose
    const nose = BABYLON.MeshBuilder.CreateSphere("nose", { diameterX: 0.13, diameterY: 0.2, diameterZ: 0.18 }, scene);
    nose.parent = customHead;
    nose.position.set(0, 0.35, 0.52);
    nose.scaling.set(1, 1, 1.2);
    nose.material = skinMat;

    // Eyes
    const eyeLeft = BABYLON.MeshBuilder.CreateSphere("eyeLeft", { diameter: 0.11 }, scene);
    eyeLeft.parent = customHead;
    eyeLeft.position.set(-0.25, 0.45, 0.42);
    eyeLeft.material = eyeMat;

    const eyeRight = BABYLON.MeshBuilder.CreateSphere("eyeRight", { diameter: 0.11 }, scene);
    eyeRight.parent = customHead;
    eyeRight.position.set(0.25, 0.45, 0.42);
    eyeRight.material = eyeMat;

    // Ears (temple anchors)
    const earLeft = BABYLON.MeshBuilder.CreateSphere("earLeft", { diameterX: 0.08, diameterY: 0.2, diameterZ: 0.1 }, scene);
    earLeft.parent = customHead;
    earLeft.position.set(-0.48, 0.35, -0.1);
    earLeft.material = skinMat;

    const earRight = BABYLON.MeshBuilder.CreateSphere("earRight", { diameterX: 0.08, diameterY: 0.2, diameterZ: 0.1 }, scene);
    earRight.parent = customHead;
    earRight.position.set(0.48, 0.35, -0.1);
    earRight.material = skinMat;

    studio.customHead = customHead;
    studio.headMesh = customHead;

    toggleWireframeState(wireframeEnabled);
    rebindShadows();
    hideLoading();
  };

  // Custom 3D Head Loader (OBJ, GLB, GLTF)
  studio.loadHeadModel = async (fileOrUrl, isCustom, format, filename) => {
    showLoading("Loading Custom Head Mesh...", 20);

    if (studio.defaultHead) studio.defaultHead.dispose();
    if (studio.customHead) studio.customHead.dispose();
    studio.defaultHead = null;
    studio.customHead = null;

    const customHead = new BABYLON.TransformNode("customHead", scene);
    customHead.parent = headGroup;

    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync("", "", fileOrUrl, scene, null, `.${format}`);
      
      result.meshes.forEach(mesh => {
        if (!mesh.parent) {
          mesh.parent = customHead;
        }
      });

      // Compute bounding info to center and normalize scale
      scene.executeWhenReady(() => {
        // Temporarily reset headGroup transforms for accurate bounding calculation
        const tempRotation = headGroup.rotation.clone();
        const tempPosition = headGroup.position.clone();
        headGroup.rotation.set(0, 0, 0);
        headGroup.position.set(0, 0, 0);

        // Calculate total bounding box of children
        let min = new BABYLON.Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
        let max = new BABYLON.Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

        customHead.getChildMeshes().forEach(mesh => {
          if (mesh.getTotalVertices() > 0) {
            mesh.computeWorldMatrix(true);
            const boundingInfo = mesh.getBoundingInfo();
            const subMin = boundingInfo.boundingBox.minimumWorld;
            const subMax = boundingInfo.boundingBox.maximumWorld;

            min = BABYLON.Vector3.Minimize(min, subMin);
            max = BABYLON.Vector3.Maximize(max, subMax);
          }
        });

        const center = max.add(min).scale(0.5);
        const size = max.subtract(min);
        const maxDimension = Math.max(size.x, size.y, size.z);

        // Scale model to standard head size (approx height 1.2 units)
        const scaleFactor = 1.3 / maxDimension;
        customHead.scaling.set(scaleFactor, scaleFactor, scaleFactor);

        // Center model at origin Y offset
        customHead.position.set(-center.x * scaleFactor, -center.y * scaleFactor + 0.35, -center.z * scaleFactor);

        // Restore headGroup transforms
        headGroup.rotation = tempRotation;
        headGroup.position = tempPosition;

        // Default shader overrides for clean viewing of OBJ files
        customHead.getChildMeshes().forEach(mesh => {
          if (!mesh.material) {
            const mat = new BABYLON.PBRMaterial("objSkin", scene);
            mat.albedoColor = new BABYLON.Color3(0.85, 0.85, 0.85);
            mat.roughness = 0.5;
            mat.metallic = 0.05;
            mesh.material = mat;
          } else {
            optimizeHeadMaterial(mesh.material);
          }
        });

        studio.customHead = customHead;
        studio.headMesh = customHead;
        studio.loadHeadModelKey = 'custom';
        studio.activeCustomHeadName = filename;
        
        // Update labels
        document.getElementById('activeHeadName').textContent = filename || "Custom Mesh";
        document.getElementById('attributionText').innerHTML = "Custom head mesh uploaded by user.";
        
        toggleWireframeState(wireframeEnabled);
        rebindShadows();
        
        // Apply saved eyewear placement specifically for this new custom head model
        if (studio.eyewearMesh) {
          const eyewearKey = getActiveEyewearKey();
          const headKey = `custom_head_${filename || 'mesh'}`;
          if (eyewearKey) {
            applySavedPlacement(eyewearKey, headKey);
            updateTransformFromSliders();
            applyMaterialOverrides();
          }
        }

        hideLoading();
        if (typeof fileOrUrl === 'string' && fileOrUrl.startsWith('blob:')) {
          URL.revokeObjectURL(fileOrUrl);
        }
      });
    } catch (err) {
      console.error("Failed to load custom uploaded head model:", err);
      alert("Error parsing 3D model. Falling back to default face scan.");
      loadDefaultHead();
      if (typeof fileOrUrl === 'string' && fileOrUrl.startsWith('blob:')) {
        URL.revokeObjectURL(fileOrUrl);
      }
    }
  };

  // Custom 3D Eyewear Loader (.glb, .gltf)
  studio.loadEyewear3D = async (fileOrUrl, filename) => {
    showLoading("Importing 3D Eyewear Model...", 30);
    studio.removeEyewear();

    if (typeof fileOrUrl !== 'string') {
      studio.activeCatalogItemId = null;
      studio.activeCustomFileName = filename;
      
      const headKey = getActiveHeadKey();
      applySavedPlacement(`custom_3d_${filename}`, headKey);
    }

    const group = new BABYLON.TransformNode("eyewear3d", scene);
    group.parent = eyewearGroup;

    const ext = filename.split('.').pop().toLowerCase();

    try {
      const result = await BABYLON.SceneLoader.ImportMeshAsync("", "", fileOrUrl, scene, null, `.${ext}`);
      
      result.meshes.forEach(mesh => {
        if (!mesh.parent) {
          mesh.parent = group;
        }
      });

      // Normalize scale and size
      let min = new BABYLON.Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
      let max = new BABYLON.Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

      group.getChildMeshes().forEach(mesh => {
        if (mesh.getTotalVertices() > 0) {
          mesh.computeWorldMatrix(true);
          const boundingInfo = mesh.getBoundingInfo();
          min = BABYLON.Vector3.Minimize(min, boundingInfo.boundingBox.minimumWorld);
          max = BABYLON.Vector3.Maximize(max, boundingInfo.boundingBox.maximumWorld);
        }
      });

      const center = max.add(min).scale(0.5);
      const size = max.subtract(min);
      const maxDimension = Math.max(size.x, size.y, size.z);

      // Scale model to fit glasses width (approx 0.8 units)
      const scaleFactor = 0.8 / maxDimension;
      group.scaling.set(scaleFactor, scaleFactor, scaleFactor);

      // Shift pivot to center of glasses
      group.position.set(-center.x * scaleFactor, -center.y * scaleFactor, -center.z * scaleFactor);

      // Create a secondary parent node for user offset modifications
      const userPivot = new BABYLON.TransformNode("userPivot", scene);
      userPivot.parent = eyewearGroup;
      group.parent = userPivot;

      studio.eyewearMesh = userPivot;
      studio.eyewearType = '3d';

      // Set default overrides
      applyMaterialOverrides();
      updateTransformFromSliders();
      rebindShadows();
      hideLoading();
      if (typeof fileOrUrl === 'string' && fileOrUrl.startsWith('blob:')) {
        URL.revokeObjectURL(fileOrUrl);
      }
    } catch (err) {
      console.error("Failed to load 3D eyewear model:", err);
      alert("Error loading 3D eyewear. Make sure it is a valid self-contained glTF/glb.");
      hideLoading();
      if (typeof fileOrUrl === 'string' && fileOrUrl.startsWith('blob:')) {
        URL.revokeObjectURL(fileOrUrl);
      }
    }
  };

  // Custom 2D Eyewear Loader (PNG, JPG)
  studio.loadEyewear2D = (url, filename) => {
    showLoading("Loading Eyewear Texture...", 50);
    studio.removeEyewear();

    studio.activeCatalogItemId = null;
    studio.activeCustomFileName = filename;

    const headKey = getActiveHeadKey();
    applySavedPlacement(`custom_2d_${filename}`, headKey);

    // Create plane for photo overlay
    const plane = BABYLON.MeshBuilder.CreatePlane("eyewear2d", { width: 1.0, height: 0.5, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
    plane.parent = eyewearGroup;

    // Create transparent material
    const material = new BABYLON.StandardMaterial("eyewear2d_mat", scene);
    const texture = new BABYLON.Texture(url, scene);
    
    // Set transparency parameters
    texture.hasAlpha = true;
    material.diffuseTexture = texture;
    material.emissiveColor = new BABYLON.Color3(1, 1, 1); // self-lit so PNG albedo stays vibrant
    material.useAlphaFromDiffuseTexture = true;
    material.backFaceCulling = false;
    plane.material = material;

    studio.eyewearMesh = plane;
    studio.eyewearType = '2d';

    applyMaterialOverrides();
    updateTransformFromSliders();
    rebindShadows();
    hideLoading();
    
    // We do NOT revoke image URL immediately as it is bound to the texture in real-time
  };

  // Dispose Eyewear
  studio.removeEyewear = () => {
    if (studio.eyewearMesh) {
      // Recursively dispose children
      studio.eyewearMesh.dispose();
      studio.eyewearMesh = null;
      studio.eyewearType = null;
    }
  };

  // Dispose Head (and load fallback default)
  studio.removeCustomHead = () => {
    loadDefaultHead();
  };

  // Toggle Default Head Scan Visibility
  studio.showDefaultHead = () => {
    loadDefaultHead();
  };

  // Toggle Custom Head Visibility
  studio.showCustomHead = () => {
    loadMannequinHead(); // Start with mannequin until custom upload occurs
  };

  // Apply User UI Transforms
  const updateTransformFromSliders = () => {
    if (!studio.eyewearMesh) return;

    const px = parseFloat(sliders.posX.input.value);
    const py = parseFloat(sliders.posY.input.value);
    const pz = parseFloat(sliders.posZ.input.value);
    
    const rx = BABYLON.Tools.ToRadians(parseFloat(sliders.rotX.input.value));
    const ry = BABYLON.Tools.ToRadians(parseFloat(sliders.rotY.input.value));
    const rz = BABYLON.Tools.ToRadians(parseFloat(sliders.rotZ.input.value));

    const s = parseFloat(sliders.scale.input.value);
    const sx = parseFloat(sliders.scaleX.input.value) * s;
    const sy = parseFloat(sliders.scaleY.input.value) * s;
    const sz = parseFloat(sliders.scaleZ.input.value) * s;

    // Apply translation
    studio.eyewearMesh.position.set(px, py, pz);

    // Apply rotation
    if (studio.eyewearMesh.rotationQuaternion) {
      studio.eyewearMesh.rotationQuaternion = null;
    }
    studio.eyewearMesh.rotation.set(rx, ry, rz);

    // Apply scaling
    studio.eyewearMesh.scaling.set(sx, sy, sz);

    // Update badges
    sliders.posX.badge.textContent = px.toFixed(2);
    sliders.posY.badge.textContent = py.toFixed(2);
    sliders.posZ.badge.textContent = pz.toFixed(2);

    sliders.rotX.badge.textContent = `${sliders.rotX.input.value}°`;
    sliders.rotY.badge.textContent = `${sliders.rotY.input.value}°`;
    sliders.rotZ.badge.textContent = `${sliders.rotZ.input.value}°`;

    sliders.scale.badge.textContent = s.toFixed(2);
    sliders.scaleX.badge.textContent = sliders.scaleX.input.value;
    sliders.scaleY.badge.textContent = sliders.scaleY.input.value;
    sliders.scaleZ.badge.textContent = sliders.scaleZ.input.value;
  };

  // Apply Material Customization overrides
  const applyMaterialOverrides = () => {
    if (!studio.eyewearMesh) return;

    const hexColor = frameColorPicker.value;
    const color = BABYLON.Color3.FromHexString(hexColor);
    const metalness = parseFloat(metalnessSlider.value);
    const roughness = parseFloat(roughnessSlider.value);
    const opacity = parseFloat(opacitySlider.value);
    const shouldOverride = overrideCheckbox ? overrideCheckbox.checked : false;

    // Update hex text label
    document.querySelector('.color-hex').textContent = hexColor;

    // Update UI numerical value labels
    document.getElementById('valFrameMetalness').textContent = metalness.toFixed(2);
    document.getElementById('valFrameRoughness').textContent = roughness.toFixed(2);
    document.getElementById('valFrameOpacity').textContent = opacity.toFixed(2);

    // Visual disabled feedback for override-controlled inputs
    const controlsToToggle = [
      frameColorPicker.closest('.control-row'),
      metalnessSlider.closest('.slider-group'),
      roughnessSlider.closest('.slider-group')
    ];
    controlsToToggle.forEach(container => {
      if (container) {
        if (shouldOverride) {
          container.classList.remove('disabled-control');
        } else {
          container.classList.add('disabled-control');
        }
      }
    });

    const processMaterial = (mat) => {
      if (!mat) return;

      if (mat.subMaterials) {
        mat.subMaterials.forEach(sub => processMaterial(sub));
        return;
      }

      // Apply opacity to all actual PBR/Standard materials
      mat.alpha = opacity;

      if (mat instanceof BABYLON.PBRMaterial) {
        if (shouldOverride) {
          // Backup original values first
          if (mat._origAlbedoColor === undefined) {
            mat._origAlbedoColor = mat.albedoColor ? mat.albedoColor.clone() : null;
            mat._origMetallic = mat.metallic;
            mat._origRoughness = mat.roughness;
          }
          // Apply overrides
          mat.albedoColor = color;
          mat.metallic = metalness;
          mat.roughness = roughness;
          mat.usePhysicalLightFalloff = true;
        } else {
          // Restore original values if they were backed up
          if (mat._origAlbedoColor !== undefined) {
            mat.albedoColor = mat._origAlbedoColor;
            mat.metallic = mat._origMetallic;
            mat.roughness = mat._origRoughness;
          }
        }
      } else if (mat instanceof BABYLON.StandardMaterial) {
        if (shouldOverride) {
          // Backup original values first
          if (mat._origDiffuseColor === undefined) {
            mat._origDiffuseColor = mat.diffuseColor ? mat.diffuseColor.clone() : null;
            mat._origSpecularColor = mat.specularColor ? mat.specularColor.clone() : null;
            mat._origSpecularPower = mat.specularPower;
          }
          // Apply overrides
          mat.diffuseColor = color;
          mat.specularColor = color.scale(metalness);
          mat.specularPower = (1 - roughness) * 128;
        } else {
          // Restore original values if they were backed up
          if (mat._origDiffuseColor !== undefined) {
            mat.diffuseColor = mat._origDiffuseColor;
            mat.specularColor = mat._origSpecularColor;
            mat.specularPower = mat._origSpecularPower;
          }
        }
      }
    };

    // Scan all mesh nodes under eyewear
    studio.eyewearMesh.getChildMeshes(false).forEach(mesh => {
      if (mesh.material) {
        if (studio.eyewearType === '2d') {
          // If 2D image texture plane, override albedo opacity only, do not colorwash texture
          mesh.material.alpha = opacity;
        } else {
          processMaterial(mesh.material);
        }
      }
    });
  };

  // Toggle Wireframe Helper
  const toggleWireframeState = (enabled) => {
    wireframeEnabled = enabled;
    if (wireframeEnabled) {
      toggleWireframeBtn.classList.add('active');
    } else {
      toggleWireframeBtn.classList.remove('active');
    }

    headGroup.getChildMeshes().forEach(mesh => {
      if (mesh.material) {
        mesh.material.wireframe = wireframeEnabled;
        if (mesh.material.subMaterials) {
          mesh.material.subMaterials.forEach(sub => {
            if (sub) sub.wireframe = wireframeEnabled;
          });
        }
      }
    });
  };

  // Wireframe Click Event
  toggleWireframeBtn.addEventListener('click', () => {
    toggleWireframeState(!wireframeEnabled);
  });

  // Reset Camera View
  resetCameraBtn.addEventListener('click', () => {
    if (camera) {
      camera.alpha = -Math.PI / 2;
      camera.beta = Math.PI / 2.1;
      camera.radius = 2.1;
      camera.target.set(0, 0.35, 0);
    }
  });

  // Head rotation update helper
  const updateHeadRotation = () => {
    if (headGroup) {
      const angle = parseFloat(headYawSlider.value);
      headGroup.rotation.y = BABYLON.Tools.ToRadians(angle);
      valHeadYawBadge.textContent = `${angle}°`;
    }
  };
  headYawSlider.addEventListener('input', updateHeadRotation);

  // Reset Adjustments
  const resetSliders = () => {
    sliders.posX.input.value = 0.0;
    sliders.posY.input.value = 0.35;
    sliders.posZ.input.value = 0.45;
    sliders.rotX.input.value = 0.0;
    sliders.rotY.input.value = 0.0;
    sliders.rotZ.input.value = 0.0;
    sliders.scale.input.value = 1.0;
    sliders.scaleX.input.value = 1.0;
    sliders.scaleY.input.value = 1.0;
    sliders.scaleZ.input.value = 1.0;

    // Reset head rotation
    if (headYawSlider) {
      headYawSlider.value = 180;
      updateHeadRotation();
    }

    // Also reset materials sliders
    frameColorPicker.value = "#cccccc";
    metalnessSlider.value = 0.8;
    roughnessSlider.value = 0.2;
    opacitySlider.value = 1.0;
    if (overrideCheckbox) {
      overrideCheckbox.checked = false;
    }
  };

  resetTransformBtn.addEventListener('click', () => {
    resetSliders();
    updateTransformFromSliders();
    applyMaterialOverrides();
  });

  // Add event listeners for sliders
  Object.values(sliders).forEach(item => {
    item.input.addEventListener('input', () => {
      updateTransformFromSliders();
    });
  });

  // Add event listeners for materials overrides
  frameColorPicker.addEventListener('input', applyMaterialOverrides);
  metalnessSlider.addEventListener('input', applyMaterialOverrides);
  roughnessSlider.addEventListener('input', applyMaterialOverrides);
  opacitySlider.addEventListener('input', applyMaterialOverrides);
  if (overrideCheckbox) {
    overrideCheckbox.addEventListener('change', applyMaterialOverrides);
  }

  // Studio light preset button clicks
  studioBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      studioBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const lightProfile = btn.getAttribute('data-light');
      setLightingProfile(lightProfile);
    });
  });

  // Welcome Modal Event Listeners
  const welcomeModal = document.getElementById('welcomeModal');
  const switchHeadBtn = document.getElementById('switchHeadBtn');
  const headCards = document.querySelectorAll('.head-card');

  if (switchHeadBtn && welcomeModal) {
    switchHeadBtn.addEventListener('click', () => {
      welcomeModal.classList.remove('hidden');
    });
  }

  headCards.forEach(card => {
    card.addEventListener('click', () => {
      const modelKey = card.getAttribute('data-head');
      loadDefaultHead(modelKey);
      if (welcomeModal) {
        welcomeModal.classList.add('hidden');
      }
    });
  });

  // Mobile Tabs Layout Toggle Logic
  const mobileTabBtns = document.querySelectorAll('.mobile-tab-btn');
  const panelLeft = document.querySelector('.panel-left');
  const panelRight = document.querySelector('.panel-right');

  mobileTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      mobileTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.getAttribute('data-target');
      if (target === 'panel-left') {
        if (panelLeft) panelLeft.classList.add('active-mobile-panel');
        if (panelRight) panelRight.classList.remove('active-mobile-panel');
      } else {
        if (panelRight) panelRight.classList.add('active-mobile-panel');
        if (panelLeft) panelLeft.classList.remove('active-mobile-panel');
      }

      // Resize Babylon engine to fit new canvas size if necessary
      if (studio.engine) {
        studio.engine.resize();
      }
    });
  });

  // Eyewear Catalog interaction - dynamic for all companies
  const companyHeaders = document.querySelectorAll('.catalog-company-header');
  const catalogItems = document.querySelectorAll('.catalog-item');

  companyHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const container = header.nextElementSibling;
      if (container && container.classList.contains('catalog-items')) {
        header.classList.toggle('collapsed');
        container.classList.toggle('collapsed');
      }
    });
  });

  // Predefined transforms for catalog items to ensure perfect fit
  const catalogPresets = {
    "about-blue-tortoise": {
      name: "Blue Tortoise",
      fileUrl: "eyeglasses/modern/about/modern_about.glb",

      // These are custom calibrated transforms for Hitem3d-1781749637597.glb
      transforms: {
        posX: 0.0,
        posY: 0.38,   // Align to nose bridge
        posZ: 0.145,  // Pulled back along Z so it sits on the face instead of floating
        rotX: 0.0,
        rotY: 180.0,  // Rotated 180 degrees to face forward!
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    },
    "access-classic-black": {
      name: "Classic Black",
      fileUrl: "eyeglasses/modern/access/Hitem3d-1781747172547.glb",
      // These are default starting transforms for Hitem3d-1781747172547.glb
      transforms: {
        posX: 0.0,
        posY: 0.38,
        posZ: 0.145,  // Pulled back along Z to sit on the face
        rotX: 0.0,
        rotY: 180.0,  // Rotated 180 degrees to face forward!
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    },
    "accord": {
      name: "Accord",
      fileUrl: "eyeglasses/modern/accord/Hitem3d-1781773546694.glb",
      transforms: {
        posX: 0.0,
        posY: 0.38,
        posZ: 0.145,
        rotX: 0.0,
        rotY: 180.0,
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    },
    "chill-modern": {
      name: "Modern Chill",
      fileUrl: "eyeglasses/modern/chill/Hitem3d-1781831328801.glb",
      transforms: {
        posX: 0.0,
        posY: 0.38,
        posZ: 0.145,
        rotX: 0.0,
        rotY: 180.0,
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    },
    "drill-mount": {
      name: "Drill Mount",
      fileUrl: "eyeglasses/generic/drill_mount.glb",
      transforms: {
        posX: 0.0,
        posY: 0.38,
        posZ: 0.145,
        rotX: 0.0,
        rotY: 180.0,
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    },
    "gold-round": {
      name: "Gold Round",
      fileUrl: "eyeglasses/generic/round_gold.glb",
      transforms: {
        posX: 0.0,
        posY: 0.38,
        posZ: 0.145,
        rotX: 0.0,
        rotY: 180.0,
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    },
    "rb4340-wayfarer-ease": {
      name: "Wayfarer Ease",
      fileUrl: "eyeglasses/Ray-Ban/rb4340_wayfarer_ease.glb",
      transforms: {
        posX: 0.0,
        posY: 0.38,
        posZ: 0.145,
        rotX: 0.0,
        rotY: 180.0,
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    },
    "rb5154-clubmaster": {
      name: "Clubmaster",
      fileUrl: "eyeglasses/Ray-Ban/rb5154_clubmaster.glb",
      transforms: {
        posX: 0.0,
        posY: 0.38,
        posZ: 0.145,
        rotX: 0.0,
        rotY: 180.0,
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    },
    "gotham-148": {
      name: "Gotham 148",
      fileUrl: "eyeglasses/Smilen-Eyewear/gotham_148.glb",
      transforms: {
        posX: 0.0,
        posY: 0.38,
        posZ: 0.145,
        rotX: 0.0,
        rotY: 180.0,
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    },
    "broadway-flex-29": {
      name: "Broadway Flex 29",
      fileUrl: "eyeglasses/Smilen-Eyewear/Broadway Flex 29.glb",
      transforms: {
        posX: 0.0,
        posY: 0.38,
        posZ: 0.145,
        rotX: 0.0,
        rotY: 180.0,
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    },
    "gotham-flex-83": {
      name: "Gotham Flex 83",
      fileUrl: "eyeglasses/Smilen-Eyewear/Gotham Flex 83.glb",
      transforms: {
        posX: 0.0,
        posY: 0.38,
        posZ: 0.145,
        rotX: 0.0,
        rotY: 180.0,
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    },
    "trendspotter-101": {
      name: "Trendspotter 101",
      fileUrl: "eyeglasses/Smilen-Eyewear/Trendspotter 101.glb",
      transforms: {
        posX: 0.0,
        posY: 0.38,
        posZ: 0.145,
        rotX: 0.0,
        rotY: 180.0,
        rotZ: 0.0,
        scale: 0.95,
        scaleX: 1.0,
        scaleY: 1.0,
        scaleZ: 1.0
      }
    }
  };




  catalogItems.forEach(item => {
    item.addEventListener('click', async () => {
      const itemId = item.getAttribute('data-id');
      const preset = catalogPresets[itemId];
      if (!preset) return;

      // Toggle active states in UI
      catalogItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      studio.activeCatalogItemId = itemId;
      studio.activeCustomFileName = null;

      // Hide custom file details if shown
      const glassesFileDetails = document.getElementById('glassesFileDetails');
      if (glassesFileDetails) {
        glassesFileDetails.classList.add('hidden');
      }

      // Load saved placement if available, otherwise use default catalog preset transforms
      const headKey = getActiveHeadKey();
      const hasSaved = applySavedPlacement(`catalog_${itemId}`, headKey);
      if (!hasSaved) {
        sliders.posX.input.value = preset.transforms.posX;
        sliders.posY.input.value = preset.transforms.posY;
        sliders.posZ.input.value = preset.transforms.posZ;
        sliders.rotX.input.value = preset.transforms.rotX;
        sliders.rotY.input.value = preset.transforms.rotY;
        sliders.rotZ.input.value = preset.transforms.rotZ;
        sliders.scale.input.value = preset.transforms.scale;
        sliders.scaleX.input.value = preset.transforms.scaleX;
        sliders.scaleY.input.value = preset.transforms.scaleY;
        sliders.scaleZ.input.value = preset.transforms.scaleZ;
      }

      // Load 3D model
      showLoading(`Loading catalog eyewear: ${preset.name}...`, 20);
      try {
        await studio.loadEyewear3D(preset.fileUrl, preset.fileUrl.split('/').pop());
        // Note: loadEyewear3D calls updateTransformFromSliders internally
      } catch (err) {
        console.error("Failed to load catalog item:", err);
      }
    });
  });

  // Save Placement Click Event
  const saveTransformBtn = document.getElementById('saveTransform');
  if (saveTransformBtn) {
    saveTransformBtn.addEventListener('click', () => {
      const eyewearKey = getActiveEyewearKey();
      const headKey = getActiveHeadKey();

      if (eyewearKey && headKey) {
        const config = {
          posX: parseFloat(sliders.posX.input.value),
          posY: parseFloat(sliders.posY.input.value),
          posZ: parseFloat(sliders.posZ.input.value),
          rotX: parseFloat(sliders.rotX.input.value),
          rotY: parseFloat(sliders.rotY.input.value),
          rotZ: parseFloat(sliders.rotZ.input.value),
          scale: parseFloat(sliders.scale.input.value),
          scaleX: parseFloat(sliders.scaleX.input.value),
          scaleY: parseFloat(sliders.scaleY.input.value),
          scaleZ: parseFloat(sliders.scaleZ.input.value)
        };
        const storageKey = `eyewear_fit_${eyewearKey}_on_${headKey}`;

        // Always save to localStorage (works offline)
        localStorage.setItem(storageKey, JSON.stringify(config));

        // Sync to server for cross-device access
        savePlacementToServer(storageKey, config);

        // Visual success state feedback on button
        const originalContent = saveTransformBtn.innerHTML;
        saveTransformBtn.innerHTML = '✓ Placement Saved!';
        saveTransformBtn.style.backgroundColor = '#10b981'; // Tailwind Emerald-500
        saveTransformBtn.style.borderColor = '#059669';
        
        setTimeout(() => {
          saveTransformBtn.innerHTML = originalContent;
          saveTransformBtn.style.backgroundColor = '';
          saveTransformBtn.style.borderColor = '';
        }, 2000);
      } else {
        alert("Please select or upload a pair of glasses first before saving placement.");
      }
    });
  }

  // Initialize!
  initEngine();
  
  // Pull all placements from server so this device is in sync with others
  syncPlacementsFromServer();

  // Show welcome modal initially
  if (welcomeModal) {
    welcomeModal.classList.remove('hidden');
  } else {
    // Backup if modal is missing
    loadDefaultHead('callie');
  }
});