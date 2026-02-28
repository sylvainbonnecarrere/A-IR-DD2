/**
 * Fix V5 Jalon 2: POST /:id/select must also toggle isDefault + update User.defaultWorkflowId
 * Writes directly to disk to bypass VS Code buffer issue.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'routes', 'workflows.routes.ts');
let content = fs.readFileSync(filePath, 'utf8');

// ===== FIX 1: updateMany — also set isDefault: false on other workflows =====
const oldUpdateMany = `            await Workflow.updateMany(
                { userId: user.id, _id: { \\$ne: workflowId } },
                { isActive: false }
            );`;

const newUpdateMany = `            // ⭐ V5: Also toggle isDefault for semantic consistency with "Sélectionner par défaut"
            await Workflow.updateMany(
                { userId: user.id, _id: { \\$ne: workflowId } },
                { isActive: false, isDefault: false }
            );`;

// Use regex to handle possible whitespace variations
const updateManyRegex = /await Workflow\.updateMany\(\s*\{ userId: user\.id, _id: \{ \$ne: workflowId \} \},\s*\{ isActive: false \}\s*\);/;

if (!updateManyRegex.test(content)) {
  console.error('❌ Could not find updateMany pattern in file');
  process.exit(1);
}

content = content.replace(
  updateManyRegex,
  `// ⭐ V5: Also toggle isDefault for semantic consistency with "Sélectionner par défaut"
            await Workflow.updateMany(
                { userId: user.id, _id: { $ne: workflowId } },
                { isActive: false, isDefault: false }
            );`
);
console.log('✅ Fix 1: updateMany now also sets isDefault: false');

// ===== FIX 2: updateOne — also set isDefault: true =====
const updateOneRegex = /await Workflow\.updateOne\(\s*\{ _id: workflowId \},\s*\{\s*isActive: true,\s*lastSavedAt: new Date\(\)\s*\}\s*\);/;

if (!updateOneRegex.test(content)) {
  console.error('❌ Could not find updateOne pattern in file');
  process.exit(1);
}

content = content.replace(
  updateOneRegex,
  `await Workflow.updateOne(
                { _id: workflowId },
                {
                    isActive: true,
                    isDefault: true,
                    lastSavedAt: new Date()
                }
            );`
);
console.log('✅ Fix 2: updateOne now also sets isDefault: true');

// ===== FIX 3: Update User.defaultWorkflowId alongside lastActiveWorkflowId =====
const userUpdateRegex = /await User\.findByIdAndUpdate\(\s*user\.id,\s*\{ lastActiveWorkflowId: workflow\._id \}\s*\);/;

if (!userUpdateRegex.test(content)) {
  console.error('❌ Could not find User.findByIdAndUpdate pattern in file');
  process.exit(1);
}

content = content.replace(
  userUpdateRegex,
  `await User.findByIdAndUpdate(
                user.id,
                { lastActiveWorkflowId: workflow._id, defaultWorkflowId: workflow._id }
            );`
);
console.log('✅ Fix 3: User update now also sets defaultWorkflowId');

// ===== WRITE =====
fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ All 3 fixes written to disk successfully');

// ===== VERIFY =====
const verify = fs.readFileSync(filePath, 'utf8');
const checks = [
  { pattern: 'isDefault: false', label: 'updateMany isDefault:false' },
  { pattern: 'isDefault: true,', label: 'updateOne isDefault:true' },
  { pattern: 'defaultWorkflowId: workflow._id', label: 'User.defaultWorkflowId' }
];

let allGood = true;
for (const check of checks) {
  if (verify.includes(check.pattern)) {
    console.log(`  ✓ ${check.label} — FOUND`);
  } else {
    console.error(`  ✗ ${check.label} — NOT FOUND`);
    allGood = false;
  }
}

if (allGood) {
  console.log('\n🎉 Jalon 2 complete — all backend fixes verified on disk');
} else {
  console.error('\n❌ Some fixes not found — manual review required');
  process.exit(1);
}
