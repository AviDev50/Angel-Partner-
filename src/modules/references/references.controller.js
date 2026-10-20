import * as referenceService from "./references.service.js";

export async function createReference(req, res) {
  try {
    const data = await referenceService.createReferenceService(req.user, req.body);
    res.status(201).json({
      success: true,
      message: "Reference submitted successfully",
      data,
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

export async function listReferences(req, res) {
  try {
    const data = await referenceService.listReferencesService(req.user, req.query);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

export async function getReference(req, res) {
  try {
    const data = await referenceService.getReferenceService(req.user, req.params.id);
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

export async function reviewReference(req, res) {
  try {
    const data = await referenceService.reviewReferenceService(
      req.user,
      req.params.id,
      req.body,
    );
    res.status(200).json({
      success: true,
      message: `Reference marked as ${data.status}`,
      data,
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  }
}