// Shows whichever file lands in the resume field. Playwright's setInputFiles
// fires a normal `change` event, so this is the same path a person clicking
// "Browse" would take. PDFs render in the frame through an object URL; text
// files are printed; anything else (DOCX) only gets the metadata, since the
// browser cannot display it inline.
(function () {
  var input = document.getElementById('resume')
  var panel = document.getElementById('resume-preview')
  var frame = document.getElementById('resume-frame')
  var text = document.getElementById('resume-text')
  var note = document.getElementById('resume-note')
  var previousUrl = null

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
  }

  function reset() {
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl)
      previousUrl = null
    }
    frame.removeAttribute('src')
    frame.hidden = true
    text.textContent = ''
    text.hidden = true
    note.textContent = ''
  }

  input.addEventListener('change', function () {
    reset()
    var file = input.files && input.files[0]
    if (!file) {
      panel.hidden = true
      return
    }

    document.getElementById('resume-name').textContent = file.name
    document.getElementById('resume-type').textContent = file.type || '(unknown)'
    document.getElementById('resume-size').textContent = formatSize(file.size)
    document.getElementById('resume-time').textContent = new Date().toLocaleTimeString()
    panel.hidden = false

    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    var isText = file.type.indexOf('text/') === 0 || /\.txt$/i.test(file.name)

    if (isPdf) {
      previousUrl = URL.createObjectURL(file)
      frame.src = previousUrl
      frame.hidden = false
      note.textContent = 'Rendered from the attached bytes. A tailored resume shows the job-specific content here.'
      return
    }
    if (isText) {
      file.text().then(function (body) {
        text.textContent = body
        text.hidden = false
      })
      return
    }
    note.textContent = 'This browser cannot display ' + (file.type || 'this file type') + ' inline; check the name and size above.'
  })
})()
