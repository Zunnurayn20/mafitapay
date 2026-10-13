import { NextResponse } from "next/server";
import {
  DATA_PLAN_CATEGORY_TYPES,
  getDataPlanCategoryKey,
  type DataPlanCategoryType,
} from "@/lib/data-plan-categories";
import { requireAdminUser, unauthorized } from "@/lib/server/auth";
import {
  getDisabledDataPlanCategories,
  insertAuditLog,
  setDataPlanCategoryDisabled,
} from "@/lib/server/data";

export async function GET() {
  const admin = await requireAdminUser();
  if (!admin) return unauthorized();
  return NextResponse.json({
    success: true,
    data: await getDisabledDataPlanCategories(),
  });
}

export async function PATCH(request: Request) {
  const admin = await requireAdminUser();
  if (!admin) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const categoryType =
    typeof body.categoryType === "string" ? body.categoryType : "";
  const rawKey =
    typeof body.categoryKey === "string" ? body.categoryKey.trim() : "";
  if (
    !DATA_PLAN_CATEGORY_TYPES.includes(categoryType as DataPlanCategoryType) ||
    !rawKey ||
    typeof body.disabled !== "boolean"
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Provide a supported category, key, and disabled status.",
      },
      { status: 400 },
    );
  }
  const type = categoryType as DataPlanCategoryType;
  const categoryKey = getDataPlanCategoryKey(type, rawKey);
  if (!categoryKey || categoryKey.length > 48) {
    return NextResponse.json(
      { success: false, error: "The data plan category key is invalid." },
      { status: 400 },
    );
  }

  const disabled = body.disabled;
  const reason =
    typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  const data = await setDataPlanCategoryDisabled({
    categoryType: type,
    categoryKey,
    disabled,
    reason,
    disabledBy: admin.email,
  });
  await insertAuditLog({
    actorUserId: admin.id,
    action: disabled
      ? "data_plan_category.disabled"
      : "data_plan_category.enabled",
    entityType: "data_plan_category",
    entityId: `${type}:${categoryKey}`,
    metadata: { categoryType: type, categoryKey, reason: reason || undefined },
  });
  return NextResponse.json({ success: true, data });
}
