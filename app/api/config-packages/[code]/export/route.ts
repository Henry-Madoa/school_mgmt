import { requireAction } from '@/lib/session';
import { exportConfigPackage } from '@/lib/configPackages';
import { parseFilters } from '@/lib/listFilters';
import { AppError } from '@/lib/errors';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  try {
    await requireAction('ADMIN_CONFIG_PACKAGE_MANAGE');
    const { code } = await params;
    const { searchParams } = new URL(request.url);
    const filters = parseFilters(searchParams.get('filters'));
    const { filename, csv } = await exportConfigPackage(code, filters);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'Export failed';
    const status = err instanceof AppError && err.code === 'FORBIDDEN' ? 403 : 400;
    return new Response(message, { status });
  }
}
