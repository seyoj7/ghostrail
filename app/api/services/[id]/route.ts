import { getServiceById } from "../../../../backend/services";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return getServiceById(id);
}

