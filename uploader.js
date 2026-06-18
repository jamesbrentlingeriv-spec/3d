// Uploader & UI Controller for 3D Eyewear Try-On Studio

document.addEventListener('DOMContentLoaded', () => {
  // Share state globally through EyewearStudio namespace
  window.EyewearStudio = window.EyewearStudio || {};
  const studio = window.EyewearStudio;

  // Cache DOM elements
  const headUploadContainer = document.getElementById('headUploadContainer');
  const headDropzone = document.getElementById('headDropzone');
  const headFileInput = document.getElementById('headFileInput');
  const headFileDetails = document.getElementById('headFileDetails');
  const removeHeadFileBtn = document.getElementById('removeHeadFile');

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const glasses3DDropzone = document.getElementById('glasses3DDropzone');
  const glasses3DFileInput = document.getElementById('glasses3DFileInput');
  const glasses2DDropzone = document.getElementById('glasses2DDropzone');
  const glasses2DFileInput = document.getElementById('glasses2DFileInput');
  const glassesFileDetails = document.getElementById('glassesFileDetails');
  const glassesFileNameText = document.getElementById('glassesFileName');
  const removeGlassesFileBtn = document.getElementById('removeGlassesFile');

  const toggleAdvancedScale = document.getElementById('toggleAdvancedScale');
  const advancedScaleContainer = document.getElementById('advancedScaleContainer');

  // Toggle Custom Head upload dropzone visibility
  const uploadHeadToggleBtn = document.getElementById('uploadHeadToggleBtn');
  let headUploadVisible = false;
  
  if (uploadHeadToggleBtn) {
    uploadHeadToggleBtn.addEventListener('click', () => {
      headUploadVisible = !headUploadVisible;
      if (headUploadVisible) {
        headUploadContainer.classList.remove('hidden');
        uploadHeadToggleBtn.textContent = 'Hide Upload Area';
        uploadHeadToggleBtn.style.background = 'rgba(255, 255, 255, 0.1)';
      } else {
        headUploadContainer.classList.add('hidden');
        uploadHeadToggleBtn.textContent = 'Upload Custom Head';
        uploadHeadToggleBtn.style.background = '';
      }
    });
  }

  // Toggle Advanced Non-Uniform Scale UI
  let advancedScaleVisible = false;
  toggleAdvancedScale.addEventListener('click', () => {
    advancedScaleVisible = !advancedScaleVisible;
    if (advancedScaleVisible) {
      advancedScaleContainer.classList.remove('hidden');
      toggleAdvancedScale.textContent = 'Hide Non-Uniform Scale';
    } else {
      advancedScaleContainer.classList.add('hidden');
      toggleAdvancedScale.textContent = 'Show Non-Uniform Scale';
    }
  });

  // Tab switching for 3D vs 2D Glasses Uploads
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.add('hidden'));

      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.remove('hidden');
    });
  });

  // Setup file click triggers
  setupClickTrigger(headDropzone, headFileInput);
  setupClickTrigger(glasses3DDropzone, glasses3DFileInput);
  setupClickTrigger(glasses2DDropzone, glasses2DFileInput);

  // Setup drag-and-drop events
  setupDragAndDrop(headDropzone, handleHeadFile);
  setupDragAndDrop(glasses3DDropzone, handleGlasses3DFile);
  setupDragAndDrop(glasses2DDropzone, handleGlasses2DFile);

  // Handle direct file inputs
  headFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleHeadFile(e.target.files[0]);
  });

  glasses3DFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleGlasses3DFile(e.target.files[0]);
  });

  glasses2DFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleGlasses2DFile(e.target.files[0]);
  });

  // Remove Head File Trigger
  removeHeadFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    headFileInput.value = '';
    headFileDetails.classList.add('hidden');
    headDropzone.classList.remove('hidden');
    if (studio.removeCustomHead) studio.removeCustomHead();
  });

  // Remove Eyewear File Trigger
  removeGlassesFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    glasses3DFileInput.value = '';
    glasses2DFileInput.value = '';
    glassesFileDetails.classList.add('hidden');
    document.querySelectorAll('.catalog-item').forEach(i => i.classList.remove('active'));
    if (studio.removeEyewear) studio.removeEyewear();
  });

  // Helper functions
  function setupClickTrigger(dropzone, fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
  }

  function setupDragAndDrop(dropzone, fileHandler) {
    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      }, false);
    });

    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files.length > 0) {
        fileHandler(files[0]);
      }
    }, false);
  }

  // File Handlers
  function handleHeadFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['obj', 'glb', 'gltf'].includes(ext)) {
      alert('Unsupported file format. Please upload .obj, .glb, or .gltf');
      return;
    }

    // Display file details
    headDropzone.classList.add('hidden');
    headFileDetails.classList.remove('hidden');
    headFileDetails.querySelector('.file-name').textContent = file.name;

    if (studio.loadHeadModel) {
      studio.loadHeadModel(file, true, ext, file.name);
    }
  }

  function handleGlasses3DFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['glb', 'gltf'].includes(ext)) {
      alert('Unsupported format. Please upload .glb or .gltf for 3D frames.');
      return;
    }

    // Display file details
    glassesFileDetails.classList.remove('hidden');
    const badge = glassesFileDetails.querySelector('.file-type-badge');
    badge.textContent = '3D';
    badge.style.background = 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)';
    glassesFileNameText.textContent = file.name;

    // Deactivate catalog selections
    document.querySelectorAll('.catalog-item').forEach(i => i.classList.remove('active'));

    if (studio.loadEyewear3D) {
      studio.loadEyewear3D(file, file.name);
    }
  }

  function handleGlasses2DFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['png', 'jpg', 'jpeg'].includes(ext)) {
      alert('Unsupported image format. Please upload a transparent PNG or JPG.');
      return;
    }

    // Display file details
    glassesFileDetails.classList.remove('hidden');
    const badge = glassesFileDetails.querySelector('.file-type-badge');
    badge.textContent = '2D';
    badge.style.background = 'linear-gradient(135deg, #ec4899 0%, #d946ef 100%)'; // Pink gradient for 2D
    glassesFileNameText.textContent = file.name;

    // Deactivate catalog selections
    document.querySelectorAll('.catalog-item').forEach(i => i.classList.remove('active'));

    // Create local Blob URL and load into scene
    const url = URL.createObjectURL(file);
    if (studio.loadEyewear2D) {
      studio.loadEyewear2D(url, file.name);
    }
  }
});
